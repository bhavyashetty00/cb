import { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import api from '../utils/api'
import { useSocket } from '../context/SocketContext'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

// Waveform visualizer
function Waveform({ active }) {
  const bars = 24
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 32 }}>
      {Array.from({ length: bars }).map((_, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 2, background: 'var(--gold)',
          height: active ? `${12 + Math.random() * 20}px` : '4px',
          transition: 'height 0.1s ease',
          opacity: active ? 0.7 + Math.random() * 0.3 : 0.3,
          animation: active ? `none` : 'none'
        }} />
      ))}
    </div>
  )
}

// Command interface
function CommandBar({ onCommand, disabled }) {
  const [value, setValue] = useState('')
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)

  const submit = async (cmd) => {
    if (!cmd.trim() || disabled) return
    onCommand(cmd.trim())
    setValue('')
  }

  const toggleVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error('Voice commands not supported in this browser')
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    recognitionRef.current = new SpeechRecognition()
    recognitionRef.current.continuous = false
    recognitionRef.current.interimResults = false
    recognitionRef.current.onresult = (e) => {
      const transcript = e.results[0][0].transcript
      setValue(transcript)
      submit(transcript)
    }
    recognitionRef.current.onend = () => setListening(false)
    recognitionRef.current.start()
    setListening(true)
  }

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '12px 16px',
      background: 'var(--ink)', borderRadius: 8, border: '1px solid rgba(250,249,246,0.1)'
    }}>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit(value)}
        placeholder={disabled ? 'Start a meeting to use commands…' : '"Summarize last 5 minutes" / "Highlight decisions" / "Add note: risk"'}
        disabled={disabled}
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--paper)', fontSize: 13, fontFamily: 'var(--font-sans)',
          opacity: disabled ? 0.4 : 1
        }}
      />
      <button
        onClick={toggleVoice}
        disabled={disabled}
        style={{
          background: listening ? 'rgba(139,26,26,0.4)' : 'rgba(250,249,246,0.06)',
          border: `1px solid ${listening ? 'rgba(139,26,26,0.6)' : 'rgba(250,249,246,0.1)'}`,
          borderRadius: 5, color: listening ? '#d44' : 'rgba(250,249,246,0.5)',
          fontSize: 14, padding: '6px 10px', cursor: 'pointer', transition: 'all 0.2s'
        }}
        title="Voice command"
      >
        {listening ? '⏹' : '🎤'}
      </button>
      <button
        onClick={() => submit(value)}
        disabled={disabled || !value.trim()}
        style={{
          background: 'var(--gold)', border: 'none', borderRadius: 5,
          color: 'var(--ink)', fontSize: 12, padding: '6px 14px',
          cursor: 'pointer', fontWeight: 600, opacity: (!value.trim() || disabled) ? 0.4 : 1
        }}
      >
        Run
      </button>
    </div>
  )
}

// Transcript line
function TranscriptLine({ line }) {
  return (
    <div className="animate-fadein" style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'flex-start' }}>
      <div style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', paddingTop: 2, flexShrink: 0, width: 44 }}>
        {line.timestamp}
      </div>
      <div style={{ fontSize: 13, color: line.isHighlight ? 'var(--ink)' : 'var(--ink-3)', lineHeight: 1.6,
        background: line.isHighlight ? 'var(--gold-light)' : 'transparent',
        borderLeft: line.isHighlight ? '3px solid var(--gold)' : '3px solid transparent',
        paddingLeft: line.isHighlight ? 8 : 0, borderRadius: line.isHighlight ? '0 4px 4px 0' : 0 }}>
        {line.text}
      </div>
    </div>
  )
}

export default function MeetingPage() {
  const { socket } = useSocket()
  const [status, setStatus] = useState('idle') // idle | recording | paused
  const [meeting, setMeeting] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [insights, setInsights] = useState({ keywords: [], actions: [], summary: '' })
  const [elapsed, setElapsed] = useState(0)
  const [cmdResult, setCmdResult] = useState(null)
  const [title, setTitle] = useState('')
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const intervalRef = useRef(null)
  const transcriptEndRef = useRef(null)

  useEffect(() => {
    if (!socket) return
    socket.on('transcript:update', (line) => {
      setTranscript(prev => [...prev, line])
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
    socket.on('insights:update', (data) => setInsights(data))
    return () => {
      socket.off('transcript:update')
      socket.off('insights:update')
    }
  }, [socket])

  useEffect(() => {
    if (status === 'recording') {
      intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [status])

  const formatTime = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  const startMeeting = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const { data } = await api.post('/api/meetings/start', { title: title || 'Executive Meeting' })
      setMeeting(data)
      setTranscript([])
      setElapsed(0)

      mediaRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      mediaRef.current.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
          // Send chunk for live transcription
          const formData = new FormData()
          formData.append('audio', e.data, 'chunk.webm')
          formData.append('meetingId', data._id)
          try {
            await api.post('/api/meetings/transcribe-chunk', formData)
          } catch (_) {}
        }
      }
      mediaRef.current.start(5000) // 5s chunks
      setStatus('recording')
      toast.success('Meeting started — recording active')
    } catch (err) {
      toast.error('Microphone access required')
    }
  }

  const pauseMeeting = () => {
    mediaRef.current?.pause()
    setStatus('paused')
  }

  const resumeMeeting = () => {
    mediaRef.current?.resume()
    setStatus('recording')
  }

  const stopMeeting = async () => {
    mediaRef.current?.stop()
    mediaRef.current?.stream.getTracks().forEach(t => t.stop())
    setStatus('idle')
    if (meeting) {
      try {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const formData = new FormData()
        formData.append('audio', blob, `${meeting._id}.webm`)
        formData.append('meetingId', meeting._id)
        await api.post('/api/meetings/stop', formData)
        toast.success('Meeting saved and indexed')
      } catch (err) {
        toast.error('Error saving meeting')
      }
    }
  }

  const markMoment = async () => {
    if (!meeting) return
    const line = { timestamp: formatTime(elapsed), text: '⚑ Key moment marked', isHighlight: true }
    setTranscript(prev => [...prev, line])
    await api.post(`/api/meetings/${meeting._id}/mark`, { timestamp: elapsed })
    toast.success('Key moment marked')
  }

  const handleCommand = async (cmd) => {
    if (!meeting) return
    try {
      const { data } = await api.post('/api/meetings/command', { command: cmd, meetingId: meeting._id })
      setCmdResult({ cmd, result: data.result, time: new Date().toLocaleTimeString() })
    } catch {
      toast.error('Command failed')
    }
  }

  const isActive = status === 'recording' || status === 'paused'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--paper)' }}>
      <Sidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--paper-3)', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            {isActive ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#c0392b',
                  animation: status === 'recording' ? 'recording-dot 1.2s ease-in-out infinite' : 'none' }} />
                <span style={{ fontSize: 13, color: 'var(--crimson)', fontWeight: 600, letterSpacing: '0.05em' }}>
                  {status === 'paused' ? 'PAUSED' : 'RECORDING'}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-3)' }}>{formatTime(elapsed)}</span>
              </div>
            ) : (
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Meeting title (optional)…"
                style={{ border: 'none', outline: 'none', fontSize: 16, fontFamily: 'var(--font-sans)',
                  color: 'var(--ink)', background: 'transparent', width: '100%' }}
              />
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isActive && (
              <button onClick={startMeeting} style={{
                padding: '9px 20px', background: 'var(--ink)', color: 'var(--paper)',
                border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500
              }}>▶ Start</button>
            )}
            {status === 'recording' && (
              <button onClick={pauseMeeting} style={{
                padding: '9px 20px', background: 'var(--paper-3)', color: 'var(--ink)',
                border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer'
              }}>⏸ Pause</button>
            )}
            {status === 'paused' && (
              <button onClick={resumeMeeting} style={{
                padding: '9px 20px', background: 'var(--paper-3)', color: 'var(--ink)',
                border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer'
              }}>▶ Resume</button>
            )}
            {isActive && (
              <>
                <button onClick={markMoment} style={{
                  padding: '9px 14px', background: 'var(--gold-light)', color: 'var(--gold)',
                  border: '1px solid var(--gold)', borderRadius: 6, fontSize: 13, cursor: 'pointer'
                }}>⚑ Mark</button>
                <button onClick={stopMeeting} style={{
                  padding: '9px 20px', background: 'var(--crimson)', color: 'white',
                  border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500
                }}>⏹ Stop</button>
              </>
            )}
          </div>
        </div>

        {/* Body: 3 columns */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 300px', overflow: 'hidden' }}>

          {/* Transcript + command */}
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--paper-3)', overflow: 'hidden' }}>
            {/* Waveform bar */}
            {isActive && (
              <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--paper-3)', background: 'var(--ink)' }}>
                <Waveform active={status === 'recording'} />
              </div>
            )}

            {/* Transcript */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {transcript.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  height: '100%', color: 'var(--ink-4)', textAlign: 'center', gap: 8 }}>
                  <div style={{ fontSize: 32, opacity: 0.2 }}>◎</div>
                  <div style={{ fontSize: 13 }}>Transcript will appear here once recording begins</div>
                </div>
              ) : (
                transcript.map((line, i) => <TranscriptLine key={i} line={line} />)
              )}
              <div ref={transcriptEndRef} />
            </div>

            {/* Command bar */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--paper-3)', background: 'var(--paper-2)' }}>
              <CommandBar onCommand={handleCommand} disabled={!isActive} />
              {cmdResult && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--ink)', borderRadius: 6, fontSize: 12 }}>
                  <div style={{ color: 'var(--gold)', marginBottom: 4, fontSize: 10, letterSpacing: '0.08em' }}>
                    COMMAND RESULT · {cmdResult.time}
                  </div>
                  <div style={{ color: 'rgba(250,249,246,0.8)', lineHeight: 1.6 }}>{cmdResult.result}</div>
                </div>
              )}
            </div>
          </div>

          {/* Insights panel */}
          <div style={{ overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              AI Insights
            </div>

            {/* Keywords */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 8, letterSpacing: '0.08em' }}>KEYWORDS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {insights.keywords.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>—</div>
                ) : insights.keywords.map((k, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '3px 8px', background: 'var(--gold-light)',
                    color: 'var(--gold)', borderRadius: 4, border: '1px solid rgba(184,146,42,0.2)' }}>
                    {k}
                  </span>
                ))}
              </div>
            </div>

            {/* Action items */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 8, letterSpacing: '0.08em' }}>ACTION ITEMS</div>
              {insights.actions.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>None detected yet</div>
              ) : insights.actions.map((a, i) => (
                <div key={i} style={{ fontSize: 12, padding: '6px 8px', marginBottom: 4,
                  background: 'var(--paper)', border: '1px solid var(--paper-3)', borderRadius: 4,
                  borderLeft: '3px solid var(--emerald)', color: 'var(--ink-2)' }}>
                  {a}
                </div>
              ))}
            </div>

            {/* Summary */}
            {insights.summary && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 8, letterSpacing: '0.08em' }}>RUNNING SUMMARY</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7,
                  padding: '10px 12px', background: 'var(--paper-2)', borderRadius: 6 }}>
                  {insights.summary}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
