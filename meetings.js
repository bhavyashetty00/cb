const router = require('express').Router()
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const Meeting = require('../models/Meeting')
const aiService = require('../services/aiService')
const logger = require('../config/logger')

const recordingsDir = process.env.AUDIO_STORAGE_PATH || './recordings'
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, recordingsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${req.body.meetingId || 'unknown'}.webm`)
})
const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_AUDIO_SIZE_MB) || 500) * 1024 * 1024 }
})

// POST /api/meetings/start
router.post('/start', async (req, res) => {
  try {
    const meeting = await Meeting.create({
      title: req.body.title || 'Executive Meeting',
      userId: req.user.id,
      status: 'recording'
    })
    const io = req.app.get('io')
    io.to(`user:${req.user.id}`).emit('meeting:started', { meetingId: meeting._id })
    logger.info('Meeting started', { meetingId: meeting._id, user: req.user.username })
    res.json(meeting)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/meetings/transcribe-chunk  (live chunks)
router.post('/transcribe-chunk', upload.single('audio'), async (req, res) => {
  try {
    const { meetingId } = req.body
    if (!meetingId || !req.file) return res.status(400).json({ error: 'Missing data' })

    const transcription = await aiService.transcribeAudio(req.file.path)
    if (transcription?.text) {
      const meeting = await Meeting.findByIdAndUpdate(meetingId,
        { $push: { transcriptChunks: { text: transcription.text, timestamp: Date.now(), confidence: transcription.confidence } } },
        { new: true }
      )
      const io = req.app.get('io')
      const line = {
        text: transcription.text,
        timestamp: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        isHighlight: false
      }
      io.to(`meeting:${meetingId}`).emit('transcript:update', line)

      // Background: run NLP insights every 5 chunks
      if (meeting.transcriptChunks.length % 5 === 0) {
        const fullText = meeting.transcriptChunks.map(c => c.text).join(' ')
        aiService.extractInsights(fullText).then(insights => {
          if (insights) io.to(`meeting:${meetingId}`).emit('insights:update', insights)
        }).catch(() => {})
      }
    }
    // Clean up chunk file
    fs.unlink(req.file.path, () => {})
    res.json({ ok: true })
  } catch (err) {
    logger.error('Transcription error', { err: err.message })
    res.status(500).json({ error: err.message })
  }
})

// POST /api/meetings/stop
router.post('/stop', upload.single('audio'), async (req, res) => {
  try {
    const { meetingId } = req.body
    if (!meetingId) return res.status(400).json({ error: 'meetingId required' })

    const updateData = { status: 'processing', endedAt: new Date() }
    if (req.file) {
      updateData.audioPath = req.file.path
      updateData.audioUrl = `/recordings/${req.file.filename}`
    }

    let meeting = await Meeting.findByIdAndUpdate(meetingId, updateData, { new: true })

    // Async: final transcription + full NLP
    setImmediate(async () => {
      try {
        const fullText = meeting.transcriptChunks.map(c => c.text).join(' ')
        const insights = await aiService.extractInsights(fullText)
        if (insights) {
          await Meeting.findByIdAndUpdate(meetingId, {
            transcript: fullText,
            summary: insights.summary,
            keywords: insights.keywords,
            actionItems: insights.actions,
            duration: Math.floor((meeting.endedAt - meeting.startedAt) / 1000),
            status: 'completed'
          })
        }
        logger.info('Meeting processed', { meetingId })
      } catch (err) {
        await Meeting.findByIdAndUpdate(meetingId, { status: 'error' })
        logger.error('Meeting processing error', { err: err.message })
      }
    })

    res.json({ ok: true, meetingId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/meetings
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [meetings, total] = await Promise.all([
      Meeting.find({ userId: req.user.id, status: { $ne: 'recording' } })
        .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))
        .select('-transcript -transcriptChunks'),
      Meeting.countDocuments({ userId: req.user.id, status: { $ne: 'recording' } })
    ])
    res.json({ meetings, total, page: parseInt(page) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/meetings/stats
router.get('/stats', async (req, res) => {
  try {
    const uid = req.user.id
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const [total, month, actions, hours] = await Promise.all([
      Meeting.countDocuments({ userId: uid }),
      Meeting.countDocuments({ userId: uid, createdAt: { $gte: monthStart } }),
      Meeting.aggregate([
        { $match: { userId: require('mongoose').Types.ObjectId.createFromHexString(uid) } },
        { $project: { actionCount: { $size: { $ifNull: ['$actionItems', []] } } } },
        { $group: { _id: null, total: { $sum: '$actionCount' } } }
      ]),
      Meeting.aggregate([
        { $match: { userId: require('mongoose').Types.ObjectId.createFromHexString(uid) } },
        { $group: { _id: null, total: { $sum: '$duration' } } }
      ])
    ])
    res.json({
      totalMeetings: total,
      monthMeetings: month,
      totalActions: actions[0]?.total || 0,
      totalHours: Math.round((hours[0]?.total || 0) / 3600 * 10) / 10
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/meetings/search
router.get('/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query
    if (!q) return res.redirect('/api/meetings')
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [meetings, total] = await Promise.all([
      Meeting.find({
        userId: req.user.id,
        $text: { $search: q }
      }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .skip(skip).limit(parseInt(limit))
        .select('-transcriptChunks'),
      Meeting.countDocuments({ userId: req.user.id, $text: { $search: q } })
    ])
    res.json({ meetings, total })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/meetings/:id
router.get('/:id', async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ _id: req.params.id, userId: req.user.id })
      .select('-transcriptChunks')
    if (!meeting) return res.status(404).json({ error: 'Not found' })
    res.json(meeting)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/meetings/:id/mark
router.post('/:id/mark', async (req, res) => {
  try {
    const meeting = await Meeting.findByIdAndUpdate(req.params.id,
      { $push: { keyMoments: { timestamp: req.body.timestamp, label: req.body.label || 'Key moment' } } },
      { new: true }
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/meetings/command
router.post('/command', async (req, res) => {
  try {
    const { command, meetingId } = req.body
    const meeting = await Meeting.findById(meetingId)
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' })
    const result = await aiService.runCommand(command, meeting.transcriptChunks.map(c => c.text).join(' '))
    res.json({ result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/meetings/:id/export
router.get('/:id/export', async (req, res) => {
  try {
    const { type = 'txt' } = req.query
    const meeting = await Meeting.findOne({ _id: req.params.id, userId: req.user.id })
    if (!meeting) return res.status(404).json({ error: 'Not found' })

    if (type === 'txt') {
      const content = `EXECUTIVE INTELLIGENCE SUITE\n${'='.repeat(50)}\n\nTitle: ${meeting.title}\nDate: ${meeting.createdAt.toISOString()}\nDuration: ${Math.round((meeting.duration || 0) / 60)} minutes\n\nSUMMARY\n${'─'.repeat(30)}\n${meeting.summary || 'N/A'}\n\nKEYWORDS\n${'─'.repeat(30)}\n${meeting.keywords?.join(', ') || 'N/A'}\n\nACTION ITEMS\n${'─'.repeat(30)}\n${meeting.actionItems?.map((a, i) => `${i+1}. ${a}`).join('\n') || 'None'}\n\nFULL TRANSCRIPT\n${'─'.repeat(30)}\n${meeting.transcript || 'N/A'}\n`
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Disposition', `attachment; filename="meeting-${meeting._id}.txt"`)
      return res.send(content)
    }

    // For pdf/docx — return formatted text for now
    // In production: use puppeteer for PDF, docx npm for DOCX
    const content = `${meeting.title}\n\nSummary: ${meeting.summary}\n\nAction Items:\n${meeting.actionItems?.join('\n')}\n\nTranscript:\n${meeting.transcript}`
    res.setHeader('Content-Type', 'text/plain')
    res.setHeader('Content-Disposition', `attachment; filename="meeting-${meeting._id}.${type}"`)
    res.send(content)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
