import os
import asyncio
import uuid
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
from typing import Optional, List, Dict
from pymongo import ReturnDocument, ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

load_dotenv()

MONGO_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("DB_NAME")
BUCKET_SIZE = int(os.getenv("CHAT_BUCKET_SIZE", 50))

class ChatDatabase:
    def __init__(self, mongo_uri: Optional[str] = None, db_name: str = DB_NAME):
        """
        Initialize the chat database connection using Motor (Async).
        """
        uri = mongo_uri or MONGO_URI
        if not uri:
            raise ValueError("MONGODB_URI environment variable is not set")
        
        # Initialize Async Client
        self.client = AsyncIOMotorClient(uri)
        self.db = self.client[db_name]
        self.sessions = self.db["chat_sessions"]
        self.messages = self.db["chat_messages"]
        self.bucket_size = BUCKET_SIZE

    async def ensure_indexes(self):
        """
        Creates necessary indexes. 
        MUST be called during application startup to prevent race conditions.
        """
        try:
            await self.messages.create_index(
                [("sessionId", ASCENDING), ("userId", ASCENDING), ("bucketId", ASCENDING)],
                unique=True,
                background=True
            )
        except Exception as e:
            print(f"Warning: Could not create index: {e}")

    async def create_session(self, session_id: str, title: str, user_id: str) -> None:
        """Creates the metadata entry for a new chat asynchronously"""
        await self.sessions.insert_one({
            "_id": session_id,
            "userId": user_id,
            "title": title,
            "created_at": datetime.utcnow(),
            "is_pinned": False
        })

    async def update_session_title(self, session_id: str, user_id: str, new_title: str) -> None:
        """Updates the title of an existing chat session"""
        await self.sessions.update_one(
            {"_id": session_id, "userId": user_id},
            {"$set": {"title": new_title}}
        )

    async def toggle_pin(self, session_id: str, user_id: str, is_pinned: bool) -> None:
        """Toggles the pinned status of a chat session"""
        await self.sessions.update_one(
            {"_id": session_id, "userId": user_id},
            {"$set": {"is_pinned": is_pinned}}
        )

    async def get_session(self, session_id: str, user_id: str) -> Optional[Dict]:
        """Check if a session exists and belongs to the user"""
        return await self.sessions.find_one({"_id": session_id, "userId": user_id})

    async def add_message(self, session_id: str, user_id: str, role: str, content: str, msg_id: str = None) -> None:
        """
        Adds a message using the Bucketing Pattern (Async).
        Thread-safe implementation using Atomic Updates and Retry logic.
        """
        timestamp = datetime.utcnow()
        new_msg = {
            "id": msg_id or str(uuid.uuid4()),
            "role": role, 
            "content": content, 
            "timestamp": timestamp,
            "feedback": "none"
        }

        while True:
            updated_bucket = await self.messages.find_one_and_update(
                {
                    "sessionId": session_id, 
                    "userId": user_id, 
                    "count": {"$lt": self.bucket_size}
                },
                {
                    "$push": {"messages": new_msg},
                    "$inc": {"count": 1}
                },
                sort=[("bucketId", DESCENDING)],
                return_document=ReturnDocument.AFTER
            )

            if updated_bucket:
                return

            last_bucket = await self.messages.find_one(
                {"sessionId": session_id, "userId": user_id}, 
                sort=[("bucketId", DESCENDING)]
            )
            
            new_bucket_id = (last_bucket["bucketId"] + 1) if last_bucket else 0

            try:
                await self.messages.insert_one({
                    "sessionId": session_id,
                    "userId": user_id,
                    "bucketId": new_bucket_id,
                    "count": 1,
                    "messages": [new_msg]
                })
                return # Success
            except DuplicateKeyError:
                continue
                
    async def update_message_feedback(self, session_id: str, user_id: str, message_id: str, feedback: str) -> bool:
        """Updates feedback (like/dislike) for a specific message inside the buckets"""
        result = await self.messages.update_one(
            {"sessionId": session_id, "userId": user_id, "messages.id": message_id},
            {"$set": {"messages.$.feedback": feedback}}
        )
        return result.modified_count > 0

    async def get_chat_history(self, session_id: str, user_id: str) -> List[Dict]:
        """Retrieves and merges all message buckets for a user's session"""
        cursor = self.messages.find(
            {"sessionId": session_id, "userId": user_id}
        ).sort("bucketId", 1)
        
        full_history = []
        async for bucket in cursor:
            for msg in bucket.get("messages", []):
                full_history.append({
                    "role": msg.get("role"),
                    "content": msg.get("content"),
                    "timestamp": msg.get("timestamp"),
                    "id": msg.get("id"),
                    "feedback": msg.get("feedback", "none")
                })
            
        return full_history

    async def list_sessions(self, user_id: str) -> List[Dict]:
        """Get all sessions for a specific user, sorted by date"""
        cursor = self.sessions.find({"userId": user_id}).sort("created_at", -1)
        sessions = await cursor.to_list(length=None)
        
        for s in sessions:
            s["id"] = s.pop("_id")
            s["is_pinned"] = s.get("is_pinned", False)
            s["message_count"] = await self.messages.count_documents({
                "sessionId": s["id"], 
                "userId": user_id
            })
        return sessions

    async def delete_session(self, session_id: str, user_id: str) -> bool:
        """Delete a session and all its messages"""
        result = await self.sessions.delete_one({"_id": session_id, "userId": user_id})
        if result.deleted_count > 0:
            await self.messages.delete_many({"sessionId": session_id, "userId": user_id})
            return True
        return False

    def close(self) -> None:
        """Close the database connection"""
        self.client.close()