// Socket.IO Server for Real-Time Chat
// This file creates a WebSocket server that handles real-time messaging between users

import { Server } from 'socket.io'
import { createServer } from 'http'
import { Redis } from '@upstash/redis'
import dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

// Initialize Redis client to check if rooms exist
const redis = Redis.fromEnv()

// Create an HTTP server (required for Socket.IO)
// Socket.IO needs an HTTP server to upgrade connections to WebSocket
const httpServer = createServer()

// Create Socket.IO server and attach it to the HTTP server
const io = new Server(httpServer, {
    cors: {
        // Allow requests from your Next.js app
        origin: process.env.CLIENT_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
    }
})

console.log('🎯 Socket.IO server initialized, waiting for connections...')
console.log('📍 CORS origin:', process.env.CLIENT_URL || 'http://localhost:3001')

// Listen for new client connections
io.on('connection', async (socket) => {
    const { roomId, username, password } = socket.handshake.query as { roomId: string; username: string; password?: string }

    // SECURITY: Validate that the room exists in Redis before allowing connection
    const roomMeta = await redis.hgetall(`meta:${roomId}`)

    if (!roomMeta || Object.keys(roomMeta).length === 0) {
        socket.emit('error', { message: 'Room not found or expired' })
        socket.disconnect(true)
        return
    }

    // SECURITY: Strict Password Validation
    const isProtected = roomMeta.passwordRequired === "true"
    const storedPassword = roomMeta.password

    if (isProtected) {
        if (!password || password !== storedPassword) {
            socket.emit('error', { message: 'Password required' })
            socket.disconnect(true)
            return
        }
    }

    socket.join(roomId)

    // Notify OTHER users in the room that someone joined
    socket.to(roomId).emit('user-joined', {
        username,
        timestamp: Date.now()
    })

    // Listen for messages from this client
    socket.on('send-message', (data: { content: string }) => {
        // Broadcast the message to OTHER users in the room
        const broadcastData = {
            username,
            content: data.content,
            timestamp: Date.now()
        }

        socket.to(roomId).emit('receive-message', broadcastData)
    })

    // Handle user disconnect
    socket.on('disconnect', () => {
        socket.to(roomId).emit('user-left', {
            username,
            timestamp: Date.now()
        })
    })
})

// Start the server on port 8080
const PORT = process.env.PORT || 8080
httpServer.listen(PORT)
