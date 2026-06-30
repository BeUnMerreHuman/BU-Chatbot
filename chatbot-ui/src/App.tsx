import './App.css'
import { Chat } from './pages/chat/chat'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext'
import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';

function App() {
  return (
    <ThemeProvider>
      <Router>
        {/* The outer div handles your app's background and theme */}
        <div className="w-full h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
          
          {/* Shown ONLY when the user is NOT logged in */}
          <SignedOut>
            <div className="flex h-full w-full items-center justify-center">
              <SignIn routing="hash" />
            </div>
          </SignedOut>

          {/* Shown ONLY when the user IS logged in */}
          <SignedIn>
            <Routes>
              <Route path="/" element={<Chat />} />
            </Routes>
          </SignedIn>

        </div>
      </Router>
    </ThemeProvider>
  )
}

export default App;