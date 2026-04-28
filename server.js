require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const mongoose = require('mongoose')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
const path = require('path')
const fs = require('fs')
const logger = require('./config/logger')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// Ensure recordings directory
const recordingsDir = process.env.AUDIO_STORAGE_PATH || './recordings'
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true })

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))
app.use(morgan('combined', { stream: { write: msg => logger.http(msg.trim()) } }))

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true })
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts' })
app.use('/api/', limiter)
app.use('/api/auth/login', authLimiter)

// Serve recordings (auth-protected via middleware)
const { verifyToken } = require('./middleware/auth')
app.use('/recordings', verifyToken, express.static(recordingsDir))

// Routes
app.use('/api/auth', require('./routes/auth'))
app.use('/api/meetings', verifyToken, require('./routes/meetings'))

// Socket.io auth + events
io.use(require('./middleware/socketAuth'))
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id} (user: ${socket.user?.username})`)
  socket.join(`user:${socket.user.id}`)

  socket.on('meeting:join', (meetingId) => socket.join(`meeting:${meetingId}`))
  socket.on('meeting:leave', (meetingId) => socket.leave(`meeting:${meetingId}`))
  socket.on('disconnect', () => logger.info(`Socket disconnected: ${socket.id}`))
})

// Attach io to app for use in routes
app.set('io', io)

// MongoDB + Start
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    logger.info('MongoDB connected')
    require('./services/adminSetup')()
    const port = process.env.PORT || 4000
    server.listen(port, () => logger.info(`EIS Backend running on :${port}`))
  })
  .catch(err => { logger.error('MongoDB connection failed:', err); process.exit(1) })

module.exports = { app, io }
