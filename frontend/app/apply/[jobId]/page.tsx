'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import LoadingSpinner from '@/components/LoadingSpinner'

interface JobInfo { id: string; title: string; company_name: string }
type PageState = 'loading_job' | 'ready' | 'submitting' | 'success' | 'error_job'

export default function ApplyPage() {
  const params = useParams()
  const jobId = params.jobId as string
  const [pageState, setPageState] = useState<PageState>('loading_job')
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null)
  const [jobError, setJobError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [elapsedTime, setElapsedTime] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    async function fetchJob() {
      // Check localStorage for already applied
      const alreadyApplied = localStorage.getItem(`applied_${jobId}`)
      if (alreadyApplied) {
        setJobError('You have already submitted an application for this position. Check your email for the result.')
        setPageState('error_job')
        return
      }
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL
        const res = await fetch(`${apiUrl}/api/jobs/${jobId}`)
        if (res.status === 410) {
          setJobError('This job posting is no longer accepting applications.')
          setPageState('error_job')
          return
        }
        if (!res.ok) throw new Error(`Job not found (${res.status})`)
        const data = await res.json()
        const job = data.job ?? data
        setJobInfo({ id: job.id, title: job.title, company_name: job.company_name })
        setPageState('ready')
      } catch (err: unknown) {
        setJobError(err instanceof Error ? err.message : 'This job posting could not be found.')
        setPageState('error_job')
      }
    }
    fetchJob()
  }, [jobId])

  // Timer during submission
  useEffect(() => {
    if (pageState === 'submitting') {
      setElapsedTime(0)
      timerRef.current = setInterval(() => setElapsedTime(p => p + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [pageState])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setFileError('')
    if (!file) { setResumeFile(null); return }
    if (file.size > 5 * 1024 * 1024) {
      setFileError('File too large. Maximum size is 5MB.')
      setResumeFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setResumeFile(file)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError('')
    if (!resumeFile) { setSubmitError('Please upload your resume.'); return }
    setPageState('submitting')
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL
      const formData = new FormData()
      formData.append('job_id', jobInfo?.id ?? jobId)
      formData.append('candidate_name', name)
      formData.append('candidate_email', email)
      formData.append('resume', resumeFile)
      const res = await fetch(`${apiUrl}/api/applications/submit`, { method: 'POST', body: formData })
      if (res.status === 409) {
        throw new Error('You have already applied for this position. Check your email for the result.')
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || body.message || `Submission failed (${res.status})`)
      }
      // Mark as applied in localStorage
      localStorage.setItem(`applied_${jobId}`, '1')
      setPageState('success')
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.')
      setPageState('ready')
    }
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(124,58,237,0.3)',
    color: '#e2e8f0', borderRadius: '12px',
    padding: '12px 16px', width: '100%', fontSize: '14px', outline: 'none',
  }

  // Loading
  if (pageState === 'loading_job') return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#070b1a' }}>
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size={40} color="#a78bfa" />
        <p className="text-sm" style={{ color: '#64748b' }}>Loading job details...</p>
      </div>
    </div>
  )

  // Error
  if (pageState === 'error_job') return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#070b1a' }}>
      <div className="rounded-2xl p-10 max-w-md w-full text-center" style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(239,68,68,0.3)'
      }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: 'rgba(239,68,68,0.15)' }}>
          <svg className="w-7 h-7" style={{ color: '#f87171' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: '#e2e8f0' }}>Job Not Found</h2>
        <p className="text-sm" style={{ color: '#64748b' }}>{jobError || 'This application link is invalid or has expired.'}</p>
      </div>
    </div>
  )

  // Success
  if (pageState === 'success') return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#070b1a' }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse,rgba(34,197,94,0.15) 0%,transparent 70%)', filter: 'blur(40px)' }} />
      <div className="rounded-2xl p-10 max-w-md w-full text-center relative z-10" style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(34,197,94,0.3)',
        boxShadow: '0 0 60px rgba(34,197,94,0.1)',
      }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: 'linear-gradient(135deg,#16a34a,#22c55e)', boxShadow: '0 0 30px rgba(34,197,94,0.4)' }}>
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-3" style={{ color: '#e2e8f0' }}>Application Submitted!</h2>
        <p style={{ color: '#94a3b8' }}>
          Thank you, <span className="font-semibold" style={{ color: '#e2e8f0' }}>{name}</span>! Your resume has been received.
        </p>
        <p className="text-sm mt-2" style={{ color: '#64748b' }}>
          Check <span className="font-medium" style={{ color: '#94a3b8' }}>{email}</span> for results within a few minutes.
        </p>
        <div className="mt-6 px-4 py-3 rounded-xl" style={{
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)'
        }}>
          <p className="text-xs" style={{ color: '#86efac' }}>
            Our AI is analyzing your resume against the job requirements. You will receive a decision email shortly.
          </p>
        </div>
      </div>
    </div>
  )

  // Submitting overlay
  if (pageState === 'submitting') return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#070b1a' }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse,rgba(124,58,237,0.2) 0%,transparent 70%)', filter: 'blur(40px)' }} />
      <div className="rounded-2xl p-10 max-w-md w-full text-center relative z-10" style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(124,58,237,0.3)',
        boxShadow: '0 0 60px rgba(124,58,237,0.15)',
      }}>
        <LoadingSpinner size={52} color="#a78bfa" />
        <h2 className="text-xl font-bold mt-6 mb-2" style={{ color: '#e2e8f0' }}>Analyzing Your Resume</h2>
        <p className="text-sm mb-4" style={{ color: '#64748b' }}>Our AI is reviewing your profile against the job requirements...</p>
        <div className="px-4 py-3 rounded-xl" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
          <p className="text-sm font-mono" style={{ color: '#a78bfa' }}>
            ⏱ {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')} elapsed
          </p>
          <p className="text-xs mt-1" style={{ color: '#475569' }}>Please keep this page open.</p>
        </div>
      </div>
    </div>
  )

  // Form
  return (
    <div className="min-h-screen px-4 py-12" style={{ background: '#070b1a', color: '#e2e8f0' }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse,rgba(124,58,237,0.15) 0%,transparent 70%)', filter: 'blur(40px)' }} />

      <div className="max-w-lg mx-auto relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)' }}>
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
              </svg>
            </div>
            <span className="text-xl font-bold" style={{ color: '#a78bfa' }}>SmartHire AI</span>
          </div>
          <p className="text-xs" style={{ color: '#475569' }}>Powered by OpenAI</p>
        </div>

        {/* Job info */}
        <div className="rounded-2xl px-6 py-5 mb-5" style={{
          background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)'
        }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#7c3aed' }}>Applying for</p>
          <h1 className="text-xl font-bold">{jobInfo?.title}</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>{jobInfo?.company_name}</p>
        </div>

        {/* Form */}
        <div className="rounded-2xl p-6 sm:p-8" style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(124,58,237,0.2)'
        }}>
          <h2 className="text-lg font-bold mb-6">Your Application</h2>

          {submitError && (
            <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5'
            }}>{submitError}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
                Full Name <span style={{ color: '#f87171' }}>*</span>
              </label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)}
                placeholder="Jane Smith" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
                Email Address <span style={{ color: '#f87171' }}>*</span>
              </label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="jane@example.com" style={inputStyle} />
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
                Resume (PDF) <span style={{ color: '#f87171' }}>*</span>
              </label>
              <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleFileChange}
                className="hidden" id="resume-upload" />
              <label htmlFor="resume-upload" className="block cursor-pointer">
                <div className="rounded-xl p-6 text-center transition-all" style={{
                  border: fileError
                    ? '2px dashed rgba(239,68,68,0.5)'
                    : resumeFile
                    ? '2px dashed rgba(34,197,94,0.5)'
                    : '2px dashed rgba(124,58,237,0.3)',
                  background: fileError
                    ? 'rgba(239,68,68,0.05)'
                    : resumeFile
                    ? 'rgba(34,197,94,0.05)'
                    : 'rgba(124,58,237,0.05)',
                }}>
                  {resumeFile ? (
                    <>
                      <svg className="w-8 h-8 mx-auto mb-2" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm font-medium" style={{ color: '#86efac' }}>{resumeFile.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                        {(resumeFile.size / 1024 / 1024).toFixed(2)} MB · Click to change
                      </p>
                    </>
                  ) : (
                    <>
                      <svg className="w-8 h-8 mx-auto mb-2" style={{ color: '#7c3aed' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="text-sm font-medium" style={{ color: '#94a3b8' }}>Click to upload your resume</p>
                      <p className="text-xs mt-0.5" style={{ color: '#475569' }}>PDF only · Max 5MB</p>
                    </>
                  )}
                </div>
              </label>
              {fileError && <p className="text-xs mt-1.5" style={{ color: '#f87171' }}>{fileError}</p>}
            </div>

            <button type="submit" disabled={!!fileError || !name || !email || !resumeFile}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-base transition-all"
              style={{
                background: 'linear-gradient(135deg,#7c3aed,#06b6d4)',
                color: '#fff', boxShadow: '0 0 25px rgba(124,58,237,0.4)',
                opacity: (!!fileError || !name || !email || !resumeFile) ? 0.5 : 1,
                cursor: (!!fileError || !name || !email || !resumeFile) ? 'not-allowed' : 'pointer',
              }}>
              Submit Application
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: '#334155' }}>
          Powered by <span style={{ color: '#64748b' }}>OpenAI</span>
        </p>
      </div>
    </div>
  )
}
