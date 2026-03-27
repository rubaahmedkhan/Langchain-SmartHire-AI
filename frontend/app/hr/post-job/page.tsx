'use client'

import { useEffect, useState, useRef, KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import LoadingSpinner from '@/components/LoadingSpinner'

export default function PostJobPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [hrId, setHrId] = useState('')
  const [hrEmail, setHrEmail] = useState('')
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [description, setDescription] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [skillInput, setSkillInput] = useState('')
  const [experience, setExperience] = useState<number | ''>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [generatedLink, setGeneratedLink] = useState('')
  const [copied, setCopied] = useState(false)
  const linkRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/hr/login'); return }
      setHrId(session.user.id)
      setHrEmail(session.user.email || '')
      const companyName = session.user.user_metadata?.company_name || ''
      if (companyName) setCompany(companyName)
      setAuthChecked(true)
    }
    checkAuth()
  }, [router])

  // Auto scroll to link when generated
  useEffect(() => {
    if (generatedLink && linkRef.current) {
      linkRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [generatedLink])

  function handleSkillKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const trimmed = skillInput.trim().replace(/,$/, '')
      if (trimmed && !skills.includes(trimmed)) setSkills([...skills, trimmed])
      setSkillInput('')
    }
  }

  function removeSkill(skill: string) { setSkills(skills.filter(s => s !== skill)) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setGeneratedLink('')
    if (!title.trim()) { setError('Job title is required.'); return }
    if (!company.trim()) { setError('Company name is required.'); return }
    if (!description.trim() || description.trim().length < 20) { setError('Please provide a detailed job description (min 20 characters).'); return }
    if (skills.length === 0) { setError('Please add at least one required skill.'); return }
    if (Number(experience) < 0) { setError('Experience years cannot be negative.'); return }
    setLoading(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL
      const res = await fetch(`${apiUrl}/api/jobs/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hr_id: hrId, hr_email: hrEmail, title,
          company_name: company, description,
          required_skills: skills,
          experience_years: Number(experience) || 0,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail = body.detail
        throw new Error(typeof detail === 'string' ? detail : body.message || `Request failed (${res.status})`)
      }
      const data = await res.json()
      const uniqueLink = data.unique_link || data.job?.unique_link
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      setGeneratedLink(`${origin}/apply/${uniqueLink}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create job. Please try again.')
    } finally { setLoading(false) }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(generatedLink)
    } catch {
      const el = document.createElement('textarea')
      el.value = generatedLink
      document.body.appendChild(el); el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(124,58,237,0.3)',
    color: '#e2e8f0',
    borderRadius: '12px',
    padding: '12px 16px',
    width: '100%',
    fontSize: '14px',
    outline: 'none',
  }

  if (!authChecked) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#070b1a' }}>
      <LoadingSpinner size={40} color="#a78bfa" />
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#070b1a', color: '#e2e8f0' }}>
      {/* Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] pointer-events-none z-0"
        style={{ background: 'radial-gradient(ellipse,rgba(124,58,237,0.18) 0%,transparent 70%)', filter: 'blur(40px)' }} />

      {/* Header */}
      <header className="sticky top-0 z-50 px-6 py-4" style={{
        background: 'rgba(7,11,26,0.9)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(124,58,237,0.2)',
      }}>
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)' }}>
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
              </svg>
            </div>
            <span className="font-bold" style={{ color: '#a78bfa' }}>SmartHire AI</span>
          </div>
          <Link href="/hr/dashboard" className="flex items-center gap-2 text-sm transition-colors"
            style={{ color: '#64748b' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 relative z-10">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">Post a New Job</h1>
          <p className="text-sm" style={{ color: '#64748b' }}>Fill in the details — AI will screen every applicant automatically.</p>
        </div>

        {/* ── SUCCESS MODAL overlay ── */}
        {generatedLink && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: 'rgba(7,11,26,0.85)', backdropFilter: 'blur(8px)' }}>
            <div ref={linkRef} className="w-full max-w-lg rounded-2xl p-8 text-center" style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(124,58,237,0.4)',
              boxShadow: '0 0 60px rgba(124,58,237,0.3)',
            }}>
              {/* Checkmark */}
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5" style={{
                background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', boxShadow: '0 0 30px rgba(124,58,237,0.5)'
              }}>
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-2">Job Created!</h2>
              <p className="text-sm mb-6" style={{ color: '#94a3b8' }}>Share this link with candidates. AI will screen every resume automatically.</p>

              {/* Link box */}
              <div className="rounded-xl p-4 mb-4 text-left" style={{
                background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)'
              }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>Application Link</p>
                <p className="text-sm break-all font-mono" style={{ color: '#c4b5fd' }}>{generatedLink}</p>
              </div>

              <button onClick={handleCopy}
                className="w-full py-3 rounded-xl font-semibold text-sm mb-3 transition-all"
                style={{
                  background: copied ? 'rgba(34,197,94,0.2)' : 'linear-gradient(135deg,#7c3aed,#06b6d4)',
                  border: copied ? '1px solid rgba(34,197,94,0.4)' : 'none',
                  color: copied ? '#86efac' : '#fff',
                  boxShadow: copied ? 'none' : '0 0 20px rgba(124,58,237,0.4)',
                }}>
                {copied ? '✓ Copied to Clipboard!' : 'Copy Link'}
              </button>

              <div className="flex gap-3">
                <Link href="/hr/dashboard"
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-center transition-all"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                  Go to Dashboard
                </Link>
                <button onClick={() => { setGeneratedLink(''); setTitle(''); setDescription(''); setSkills([]); setExperience('') }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                  style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa' }}>
                  Post Another
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl text-sm" style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5'
          }}>{error}</div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="rounded-2xl p-6 sm:p-8 space-y-6" style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(124,58,237,0.2)', backdropFilter: 'blur(8px)'
        }}>
          {/* Title + Company */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
                Job Title <span style={{ color: '#f87171' }}>*</span>
              </label>
              <input type="text" required value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Senior Software Engineer" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
                Company Name <span style={{ color: '#f87171' }}>*</span>
              </label>
              <input type="text" required value={company} onChange={e => setCompany(e.target.value)}
                placeholder="e.g. Acme Corp" style={inputStyle} />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
              Job Description <span style={{ color: '#f87171' }}>*</span>
            </label>
            <textarea required rows={5} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Describe the role, responsibilities, and what you're looking for..."
              style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {/* Skills */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
              Required Skills <span style={{ color: '#f87171' }}>*</span>
            </label>
            <div className="rounded-xl p-3 min-h-[52px]" style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(124,58,237,0.3)'
            }}>
              <div className="flex flex-wrap gap-2 mb-2">
                {skills.map(skill => (
                  <span key={skill} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }}>
                    {skill}
                    <button type="button" onClick={() => removeSkill(skill)} style={{ color: '#a78bfa' }}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
              <input type="text" value={skillInput} onChange={e => setSkillInput(e.target.value)}
                onKeyDown={handleSkillKeyDown} placeholder="Type a skill and press Enter..."
                style={{ background: 'transparent', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: '14px', width: '100%' }} />
            </div>
            <p className="text-xs mt-1.5" style={{ color: '#475569' }}>Press Enter after each skill to add it as a tag.</p>
          </div>

          {/* Experience */}
          <div className="max-w-xs">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
              Min. Years of Experience
            </label>
            <input type="number" min={0} max={30} value={experience}
              onChange={e => setExperience(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="0" style={inputStyle} />
          </div>

          {/* Submit */}
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-base transition-all"
            style={{
              background: loading ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg,#7c3aed,#06b6d4)',
              color: '#fff', boxShadow: loading ? 'none' : '0 0 25px rgba(124,58,237,0.5)',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
            {loading && <LoadingSpinner size={18} color="white" />}
            {loading ? 'Creating Job...' : 'Create Job & Get Link'}
          </button>
        </form>
      </main>
    </div>
  )
}
