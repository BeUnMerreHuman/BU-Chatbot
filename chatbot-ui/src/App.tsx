import './App.css';
import { Chat } from './pages/chat/chat';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';

function App() {
  return (
    <ThemeProvider>
      <Router>
        <div className="ocean-bg relative w-full h-screen text-white overflow-hidden">

          {/* 1. SIGN OUT VIEW */}
          <SignedOut>
            <div className="flex w-full h-full items-center justify-center p-4 sm:p-8">
              <div className="relative z-10 flex w-full items-center justify-center p-4">
                <SignIn 
                  routing="hash" 
                  appearance={{
                    variables: {
                      colorText: "white",
                      colorPrimary: "#0ea5e9",
                      colorBackground: "transparent",
                      colorInputBackground: "rgba(0,0,0,0.2)",
                      colorInputText: "white",
                    },
                    elements: {
                      card: "bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl",
                      footer: "bg-transparent", 
                      headerTitle: "text-white",
                      headerSubtitle: "text-gray-300",
                      dividerLine: "bg-white/20",
                      dividerText: "text-gray-300",
                      formFieldLabel: "text-gray-200",
                      formFieldInput: "bg-black/20 border-white/10 text-white placeholder:text-gray-400 focus:border-cyan-400",
                      socialButtonsBlockButton: "bg-white/5 border border-white/10 hover:bg-white/10 text-white",
                      socialButtonsBlockButtonText: "text-white font-medium",
                      formButtonPrimary: "bg-cyan-600 hover:bg-cyan-500 text-white border-none",
                      footerActionText: "text-gray-300",
                      footerActionLink: "text-cyan-400 hover:text-cyan-300"
                    }
                  }}
                />
              </div>
            </div>
          </SignedOut>

          {/* 2. SIGNED IN VIEW  */}
          <SignedIn>
            <div className="relative z-10 w-full h-full bg-white/5 backdrop-blur-sm overflow-hidden flex flex-col">
              <div className="h-full w-full">
                <Routes>
                  <Route path="/" element={<Chat />} />
                </Routes>
              </div>
            </div>
          </SignedIn>

        </div>
      </Router>
    </ThemeProvider>
  );
}

export default App;