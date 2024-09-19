// File: pages/_app.js
import { AuthProvider } from '../contexts/AuthContext';
import '../styles/globals.css';

function MyApp({ Component, pageProps }) {
  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  );
}

export default MyApp;

// File: pages/index.js
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/router';
import ChatInterface from '../components/ChatInterface';
import SignIn from '../components/SignIn';

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      router.push('/signin');
    }
  }, [user, router]);

  return (
    <div className="container mx-auto px-4">
      <h1 className="text-3xl font-bold my-4">AI Content Generation</h1>
      {user ? <ChatInterface /> : <SignIn />}
    </div>
  );
}

// File: pages/api/chat.js
import { verifyIdToken } from '../../utils/firebaseAdmin';
import { rateLimiter } from '../../utils/rateLimiter';
import { saveChatToFirestore } from '../../utils/firestoreUtils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const decodedToken = await verifyIdToken(token);
    const userId = decodedToken.uid;

    // Apply rate limiting
    const limiterRes = await rateLimiter.limit(userId);
    if (!limiterRes.success) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    const { message } = req.body;

    // Call Dify API
    const difyResponse = await fetch('YOUR_DIFY_API_URL', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DIFY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: message, user: userId }),
    });

    const difyData = await difyResponse.json();

    // Save chat to Firestore
    await saveChatToFirestore(userId, message, difyData.answer);

    res.status(200).json(difyData);
  } catch (error) {
    console.error('Error in chat API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// File: components/ChatInterface.js
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function ChatInterface() {
  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const { user } = useAuth();

  const sendMessage = async () => {
    if (!message.trim()) return;

    const newMessage = { role: 'user', content: message };
    setChatHistory([...chatHistory, newMessage]);
    setMessage('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({ message }),
      });

      const data = await response.json();
      setChatHistory(prev => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  return (
    <div className="chat-interface">
      <div className="chat-history">
        {chatHistory.map((msg, index) => (
          <div key={index} className={`message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>
      <div className="message-input">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type your message..."
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}

// File: contexts/AuthContext.js
import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../utils/firebase';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// File: utils/firebase.js
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  // Your Firebase configuration
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// File: utils/firebaseAdmin.js
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

export const verifyIdToken = (token) => {
  return admin.auth().verifyIdToken(token);
};

// File: utils/rateLimiter.js
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const rateLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
});

// File: utils/firestoreUtils.js
import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export const saveChatToFirestore = async (userId, message, response) => {
  try {
    await addDoc(collection(db, 'chats'), {
      userId,
      message,
      response,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error saving chat to Firestore:', error);
  }
};