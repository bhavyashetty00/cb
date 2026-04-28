const router = require('express').Router()
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const logger = require('../config/logger')
const { verifyToken } = require('../middleware/auth')

function signAccess(user) {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  )
}

function signRefresh(user) {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  )
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password, pin } = req.body
  const ip = req.ip

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' })
  }

  try {
    const user = await User.findOne({ username: username.toLowerCase() })
    if (!user || !user.verifyPassword(password)) {
      logger.warn('Failed login attempt', { username, ip })
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (pin !== undefined && !user.verifyPin(pin)) {
      logger.warn('Invalid PIN attempt', { username, ip })
      return res.status(401).json({ error: 'Invalid PIN' })
    }

    const accessToken = signAccess(user)
    const refreshToken = signRefresh(user)

    user.cleanTokens()
    user.refreshTokens.push({ token: refreshToken })
    user.lastLogin = new Date()
    user.loginCount += 1
    await user.save()

    logger.info('Successful login', { username, ip, loginCount: user.loginCount })

    res.json({
      accessToken,
      refreshToken,
      user: { id: user._id, username: user.username, role: user.role }
    })
  } catch (err) {
    logger.error('Login error', { err: err.message })
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/logout
router.post('/logout', verifyToken, async (req, res) => {
  const { refreshToken } = req.body
  try {
    const user = await User.findById(req.user.id)
    if (user) {
      user.refreshTokens = user.refreshTokens.filter(t => t.token !== refreshToken)
      await user.save()
    }
    logger.info('User logged out', { username: req.user.username })
    res.json({ message: 'Session terminated' })
  } catch {
    res.json({ message: 'Logged out' })
  }
})

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' })

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
    const user = await User.findById(payload.id)
    if (!user) return res.status(401).json({ error: 'User not found' })

    const stored = user.refreshTokens.find(t => t.token === refreshToken)
    if (!stored) return res.status(401).json({ error: 'Token revoked' })

    const accessToken = signAccess(user)
    res.json({ accessToken })
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' })
  }
})

// GET /api/auth/me
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash -pinHash -refreshTokens')
    if (!user) return res.status(404).json({ error: 'Not found' })
    res.json(user)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
