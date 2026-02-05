# BU Chatbot: Bahria University Student Smart Assistant

An intelligent, RAG-powered (Retrieval-Augmented Generation) chatbot designed to help students navigate the **Bahria University Student Rulebook (Spring 2025)**. This project leverages MongoDB Atlas for vector search, Groq for high-speed LLM inference, and Clerk for secure user authentication.

---

## 🚀 Overview

The BU Chatbot transforms a static PDF rulebook into an interactive AI assistant. It uses a hybrid search approach (Regex + Vector Search) to provide accurate answers based on the official university guidelines.

### Key Features

* **RAG Engine:** Combines semantic vector search with specific rule/page regex matching.
* **Async Performance:** Built with FastAPI and Motor (Async MongoDB driver) for high concurrency.
* **Memory Management:** Implements the **Bucketing Pattern** in MongoDB to store and retrieve chat history efficiently.
* **Authentication:** Integrated with Clerk for secure, JWT-based user session management.
* **Automated Knowledge Base:** Scripts to automatically download, process, and ingest university rules from Kaggle into MongoDB Atlas.

---

## 🛠️ Tech Stack

* **Backend:** FastAPI (Python)
* **LLM:** Groq (Llama 3.1 8B)
* **Database:** MongoDB Atlas (Vector Search & Chat Storage)
* **Embeddings:** FastEmbed (`all-MiniLM-L6-v2`)
* **Auth:** Clerk
* **Dataset:** Kaggle (Structured JSON)

---

## 📋 Prerequisites

1. **Python 3.9+**
2. **MongoDB Atlas Account:** Create a cluster and obtain your connection string.
3. **Groq API Key:** Get one from the [Groq Console](https://console.groq.com/).
4. **Clerk Account:** Set up an application to get your API keys and JWT configuration.

---

## ⚙️ Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/BeUnMerreHuman/BU-Chatbot.git
cd BU-Chatbot

```

### 2. Install Dependencies

```bash
pip install -r requirements.txt

```

### 3. Configure Environment Variables

Create a `.env` file in the root directory and populate it with your credentials:

```env
# Database Configuration
MONGODB_URI=your_mongodb_atlas_uri
DB_NAME=data
CHAT_BUCKET_SIZE=50
VECTOR_INDEX_NAME=vector_index
VECTOR_COLLECTION_NAME=rules

# AI Configuration
GROQ_API_KEY=your_groq_api_key

# Clerk Authentication
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_ISSUER=https://your-issuer-url
CLERK_JWKS_URL=https://api.clerk.com/v1/jwks

```

### 4. Initialize the Database

Run the `AddData.py` script. This script performs three critical tasks:

1. Downloads the [BU Student Rulebook Dataset](https://www.kaggle.com/datasets/muneeburrehman98/bu-student-rulebook-spring-2025-structured-json) from Kaggle.
2. Initializes the MongoDB schema, including chat session and message collections.
3. Vectorizes the rules and uploads them to your Atlas Cluster.

```bash
python AddData.py

```

> **Note:** You must create a **Vector Search Index** in MongoDB Atlas named `vector_index` on the `rules` collection to enable semantic search.

---

## 🏃 Running the Application

Start the FastAPI server:

```bash
python -m uvicorn main:app

```

The application will be available at `http://localhost:8000`.

---

## 📂 Project Structure

* `main.py`: The FastAPI application entry point and API endpoints.
* `RAGengine.py`: Logic for query contextualization, document retrieval, and LLM answer generation.
* `database.py`: Handles all MongoDB interactions using the Bucketing Pattern for chat history.
* `AddData.py`: Data ingestion pipeline (Kaggle -> Vector Store).
* `static/`: Contains the frontend assets (`index.html`, `script.js`, `style.css`).
* `requirements.txt`: List of Python dependencies.
