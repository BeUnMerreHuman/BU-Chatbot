# BU Chatbot UI

A modern React + TypeScript chat interface for interacting with the **BU RAG Chatbot**. This frontend communicates with a custom FastAPI backend that provides Retrieval-Augmented Generation (RAG), real-time streaming responses, authentication, and chat history management.

## Overview

This project serves as the frontend for the BU RAG Chatbot. It provides a clean, responsive chat interface with real-time streaming and integrates seamlessly with the custom backend.

### Features

* Modern React + TypeScript interface
* Real-time streaming responses via WebSockets
* Markdown rendering
* Light and dark mode
* Chat history management
* Session-based conversations
* Authentication support
* Responsive UI

## Project Architecture

```text
Frontend (React + TypeScript)
            │
            │ WebSocket / REST API
            ▼
Backend (FastAPI)
            │
            ├── Authentication
            ├── Chat History
            ├── RAG Engine
            └── Vector Database
```

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/BeUnMerreHuman/BU-Chatbot.git
cd BU-Chatbot
cd chatbot-ui
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure the backend

Ensure the RAG backend is running and update any required API or WebSocket endpoints if necessary.


### 4. Configure Environment Variables

Create a `.env` file in the chatbot-ui directory and populate it with your credential:

```env
# Clerk Authentication
VITE_CLERK_PUBLISHABLE_KEY=pk_test_....
```


### 5. Start the development server

```bash
npm run dev
```

The application will be available at:

```
http://localhost:8501
```

## Backend

This frontend is designed to work with the BU RAG backend, which provides:

* Retrieval-Augmented Generation (RAG)
* WebSocket response streaming
* Conversation management
* User authentication
* Persistent chat history
* Session management

## Technologies Used

* React
* TypeScript
* Vite
* Tailwind CSS
* WebSockets
* Markdown Rendering

## Acknowledgements

This project is **based on** the excellent open-source **Chatbot UI** created by Leon Binder and Christoph Handschuh.

Original repository:

* https://github.com/ChristophHandschuh/chatbot-ui

The original project includes contributions from:

* **Leon Binder** – Original Chatbot UI
* **Christoph Handschuh** – Project maintainer
* **CameliaK** – Web search integration
* **GBG7** – WebSocket connection refactoring

### Modifications

This repository has been adapted for the BU RAG Chatbot project. The following changes were made:
* Modified Sidebar and Header files
* Integrated with a custom FastAPI RAG backend
* Connected the frontend to custom REST and WebSocket APIs
* Updated the chat workflow for RAG-based responses
* Modified parts of the user interface and branding
* Added support for backend authentication and session management

## License

This project retains the Apache License 2.0 from the original Chatbot UI project where applicable.

Please refer to the original repository for licensing details and attribution requirements.
