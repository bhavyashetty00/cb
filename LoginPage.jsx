import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

const s = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--ink)', position: 'relative', overflow: 'hidden'
  },
  grain: {
    position: 'absolute', inset: 0, opacity: 0.04,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'repeat', backgroundSize: '128px 128px'
  },
  accent: {
    position: 'absolute', top: '-40%', right: '-20%', width: '70vw', height: '70vw',
    borderRadius: '50%', background: 'radial-gradient(circle, rgba(184,146,42,0.06) 0%, transparent 70%)',
    pointerEvents: 'none'
  },
  card: {
    position: 'relative', zIndex: 1, width: 380, padding: '48px 40px',
    background: 'rgba(250,249,246,0.04)', border: '1px solid rgba(250,249,246,0.08)',
    borderRadius: 16, backdropFilter: 'blur(20px)'
  },
  logo: {
    fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.3em',
    color: 'var(--gold)', textTransform: 'uppercase', marginBottom: 8
  },
  title: {
    fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--paper)',
    lineHeight: 1.2, marginBottom: 6
  },
  sub: { fontSize: 12, color: 'rgba(250,249,246,0.4)', marginBottom: 36, letterSpacing: '0.05em' },
  label: { fontSize: 11, color: 'rgba(250,249,246,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6, display: 'block' },
  input: {
    width: '100%', padding: '12px 14px', background: 'rgba(250,249,246,0.06)',
    border: '1px solid rgba(250,249,246,0.12)', borderRadius: 6, color: 'var(--paper)',
    fontSize: 14, fontFamily: 'var(--font-sans)', outline: 'none', marginBottom: 16,
    transition: 'border-color 0.2s'
  },
  btn: {
    width: '100%', padding: '13px', background: 'var(--gold)',
    border: 'none', borderRadius: 6, color: 'var(--ink)',
    fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
    transition: 'opacity 0.2s, transform 0.1s', marginTop: 8
  },
  tab: (active) => ({
    flex: 1, padding: '8px', background: active ? 'rgba(250,249,246,0.1)' : 'transparent',
    border: 'none', borderRadius: 4, color: active ? 'var(--paper)' : 'rgba(250,249,246,0.4)',
    fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', transition: 'all 0.2s',
    letterSpacing: '0.05em'
  }),
  tabGroup: {
    display: 'flex', gap: 4, padding: 4, background: 'rgba(250,249,246,0.04)',
    borderRadius: 8, marginBottom: 28, border: '1px solid rgba(250,249,246,0.08)'
  }
}

export default function LoginPage() {
  const [mode, setMode] = useState('password') // 'password' | 'pin'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const nav = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(username, password, mode === 'pin' ? pin : undefined)
      toast.success('Welcome back')
      nav('/')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.grain} />
      <div style={s.accent} />
      <div style={s.card}>
        <div style={s.logo}>Executive Intelligence Suite</div>
        <div style={s.title}>Secure Access</div>
        <div style={s.sub}>BOARD-LEVEL MEETING INTELLIGENCE · ADMIN ONLY</div>

        <div style={s.tabGroup}>
          <button style={s.tab(mode === 'password')} onClick={() => setMode('password')}>Password</button>
          <button style={s.tab(mode === 'pin')} onClick={() => setMode('pin')}>PIN + Password</button>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={s.label}>Username</label>
          <input
            style={s.input}
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="admin"
            autoComplete="username"
            required
            onFocus={e => e.target.style.borderColor = 'rgba(184,146,42,0.6)'}
            onBlur={e => e.target.style.borderColor = 'rgba(250,249,246,0.12)'}
          />
          <label style={s.label}>Password</label>
          <input
            style={s.input}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••••••"
            autoComplete="current-password"
            required
            onFocus={e => e.target.style.borderColor = 'rgba(184,146,42,0.6)'}
            onBlur={e => e.target.style.borderColor = 'rgba(250,249,246,0.12)'}
          />
          {mode === 'pin' && (
            <>
              <label style={s.label}>6-Digit PIN</label>
              <input
                style={s.input}
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g,'').slice(0,6))}
                placeholder="······"
                maxLength={6}
                required
                onFocus={e => e.target.style.borderColor = 'rgba(184,146,42,0.6)'}
                onBlur={e => e.target.style.borderColor = 'rgba(250,249,246,0.12)'}
              />
            </>
          )}
          <button
            style={{...s.btn, opacity: loading ? 0.6 : 1}}
            type="submit"
            disabled={loading}
          >
            {loading ? 'Authenticating…' : 'Enter Suite'}
          </button>
        </form>

        <div style={{ marginTop: 24, fontSize: 11, color: 'rgba(250,249,246,0.2)', textAlign: 'center', letterSpacing: '0.05em' }}>
          ENCRYPTED · AUDIT LOGGED · ADMIN ONLY
        </div>
      </div>
    </div>
  )
}
