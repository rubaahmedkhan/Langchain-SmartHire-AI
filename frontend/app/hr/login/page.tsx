'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import LoadingSpinner from '@/components/LoadingSpinner'

type Tab = 'login' | 'signup'

export default function HRLoginPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('login')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [signupName, setSignupName] = useState('')
  const [signupCompany, setSignupCompany] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccessMsg(''); setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: loginEmail, password: loginPassword,
      })
      if (authError) throw authError
      router.push('/hr/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally { setLoading(false) }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccessMsg(''); setLoading(true)
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: signupEmail, password: signupPassword,
        options: { data: { name: signupName, company_name: signupCompany, role: 'hr' } },
      })
      if (authError) throw authError
      const userId = data.user?.id
      if (userId) {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL
        await fetch(`${apiUrl}/api/hr/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: userId, name: signupName, company_name: signupCompany, email: signupEmail }),
        })
      }
      router.push('/hr/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign up failed. Please try again.')
    } finally { setLoading(false) }
  }

  const inputCls = `w-full px-4 py-3 rounded-xl text-sm outline-none transition-all`
  const inputStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(124,58,237,0.3)',
    color: '#e2e8f0',
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: '#070b1a' }}>
      {/* Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse,rgba(124,58,237,0.2) 0%,transparent 70%)', filter: 'blur(40px)' }} />

      {/* Back */}
      <Link href="/" className="flex items-center gap-2 mb-8 text-sm transition-colors"
        style={{ color: '#64748b' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
        onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to Home
      </Link>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)' }}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
              </svg>
            </div>
            <span className="text-2xl font-bold" style={{ color: '#a78bfa' }}>SmartHire AI</span>
          </div>
          <p className="text-sm" style={{ color: '#64748b' }}>HR Portal — Sign in or create your account</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl overflow-hidden" style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(124,58,237,0.25)',
          backdropFilter: 'blur(16px)',
        }}>
          {/* Tabs */}
          <div className="flex" style={{ borderBottom: '1px solid rgba(124,58,237,0.2)' }}>
            {(['login', 'signup'] as Tab[]).map((t) => (
              <button key={t} onClick={() => { setTab(t); setError(''); setSuccessMsg('') }}
                className="flex-1 py-4 text-sm font-semibold transition-all"
                style={{
                  color: tab === t ? '#a78bfa' : '#475569',
                  borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent',
                  background: tab === t ? 'rgba(124,58,237,0.08)' : 'transparent',
                }}>
                {t === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <div className="p-5 sm:p-8">
            {/* Error */}
            {error && (
              <div className="mb-5 px-4 py-3 rounded-xl text-sm" style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5'
              }}>{error}</div>
            )}
            {successMsg && (
              <div className="mb-5 px-4 py-3 rounded-xl text-sm" style={{
                background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac'
              }}>{successMsg}</div>
            )}

            {/* Login Form */}
            {tab === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#64748b' }}>Email</label>
                  <input type="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                    placeholder="you@company.com" className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#64748b' }}>Password</label>
                  <input type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                    placeholder="••••••••" className={inputCls} style={inputStyle} />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all mt-2"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', boxShadow: '0 0 20px rgba(124,58,237,0.4)', opacity: loading ? 0.7 : 1 }}>
                  {loading && <LoadingSpinner size={16} color="white" />}
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
            )}

            {/* Signup Form */}
            {tab === 'signup' && (
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#64748b' }}>Full Name</label>
                    <input type="text" required value={signupName} onChange={e => setSignupName(e.target.value)}
                      placeholder="Jane Smith" className={inputCls} style={inputStyle} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#64748b' }}>Company</label>
                    <input type="text" required value={signupCompany} onChange={e => setSignupCompany(e.target.value)}
                      placeholder="Acme Corp" className={inputCls} style={inputStyle} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#64748b' }}>Email</label>
                  <input type="email" required value={signupEmail} onChange={e => setSignupEmail(e.target.value)}
                    placeholder="you@company.com" className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#64748b' }}>Password</label>
                  <input type="password" required minLength={6} value={signupPassword} onChange={e => setSignupPassword(e.target.value)}
                    placeholder="Min. 6 characters" className={inputCls} style={inputStyle} />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all mt-2"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', color: '#fff', boxShadow: '0 0 20px rgba(124,58,237,0.4)', opacity: loading ? 0.7 : 1 }}>
                  {loading && <LoadingSpinner size={16} color="white" />}
                  {loading ? 'Creating Account...' : 'Create Account'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
