import './App.css';
import React from 'react';
import SignUp from "./SignUp/SignUp";
import SignIn from "./SignIn/SignIn";
import Chat from "./Chat/Chat";
import ChatList from "./ChatList/ChatList";
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';



function App() {
    return (
        <React.StrictMode>
            <Router> 
                <Routes>
                   <Route path="/signin" element={<SignIn />} />
                    <Route path="/signup" element={<SignUp />} />
                    <Route path="/user" element={<ChatList />} />
                    <Route path="/" element={<SignIn />} />
                    <Route path="/chat/:id" element={<Chat />} />
                </Routes>
            </Router>

        </React.StrictMode>
    );
}

export default App;
