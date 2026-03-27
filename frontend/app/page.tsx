'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef } from 'react'

function NeuralNetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const leftNodes  = [0.22, 0.36, 0.50, 0.64, 0.78]
    const centerNodes = [0.28, 0.42, 0.58, 0.72]
    const rightNodes  = [0.25, 0.42, 0.60, 0.78]

    type Particle = {
      progress: number
      speed: number
      fromX: number; fromY: number
      toX: number;   toY: number
      color: string
      size: number
    }

    const particles: Particle[] = []

    const connections: { fx: number; fy: number; tx: number; ty: number; color: string }[] = []
    leftNodes.forEach((ly) => {
      centerNodes.forEach((cy) => {
        connections.push({ fx: 0.26, fy: ly, tx: 0.50, ty: cy, color: 'purple' })
      })
    })
    centerNodes.forEach((cy) => {
      rightNodes.forEach((ry) => {
        connections.push({ fx: 0.50, fy: cy, tx: 0.74, ty: ry, color: 'cyan' })
      })
    })

    const spawnParticle = () => {
      const conn = connections[Math.floor(Math.random() * connections.length)]
      particles.push({
        progress: 0,
        speed: 0.003 + Math.random() * 0.004,
        fromX: conn.fx, fromY: conn.fy,
        toX: conn.tx,   toY: conn.ty,
        color: conn.color,
        size: 2 + Math.random() * 2.5,
      })
    }

    for (let i = 0; i < 22; i++) {
      const conn = connections[Math.floor(Math.random() * connections.length)]
      particles.push({
        progress: Math.random(),
        speed: 0.003 + Math.random() * 0.004,
        fromX: conn.fx, fromY: conn.fy,
        toX: conn.tx,   toY: conn.ty,
        color: conn.color,
        size: 2 + Math.random() * 2.5,
      })
    }

    let frame = 0
    let animId: number

    const draw = () => {
      animId = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      frame++

      const w = canvas.width
      const h = canvas.height

      // Static connection lines
      connections.forEach((c) => {
        ctx.beginPath()
        ctx.moveTo(c.fx * w, c.fy * h)
        ctx.lineTo(c.tx * w, c.ty * h)
        ctx.strokeStyle = c.color === 'purple'
          ? 'rgba(124,58,237,0.15)'
          : 'rgba(6,182,212,0.15)'
        ctx.lineWidth = 0.8
        ctx.stroke()
      })

      // Left nodes (purple)
      leftNodes.forEach((ly) => {
        const x = 0.26 * w, y = ly * h
        const g = ctx.createRadialGradient(x, y, 0, x, y, 12)
        g.addColorStop(0, 'rgba(124,58,237,0.8)')
        g.addColorStop(1, 'rgba(124,58,237,0)')
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2)
        ctx.fillStyle = g; ctx.fill()
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fillStyle = '#a78bfa'; ctx.fill()
      })

      // Center nodes (bright pulsing)
      centerNodes.forEach((cy, i) => {
        const x = 0.50 * w, y = cy * h
        const pulse = 1 + 0.18 * Math.sin(frame * 0.055 + i * 1.5)
        const g = ctx.createRadialGradient(x, y, 0, x, y, 18 * pulse)
        g.addColorStop(0, 'rgba(167,139,250,1)')
        g.addColorStop(0.5, 'rgba(124,58,237,0.5)')
        g.addColorStop(1, 'rgba(124,58,237,0)')
        ctx.beginPath(); ctx.arc(x, y, 18 * pulse, 0, Math.PI * 2)
        ctx.fillStyle = g; ctx.fill()
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'; ctx.fill()
      })

      // Right nodes (cyan)
      rightNodes.forEach((ry) => {
        const x = 0.74 * w, y = ry * h
        const g = ctx.createRadialGradient(x, y, 0, x, y, 12)
        g.addColorStop(0, 'rgba(6,182,212,0.8)')
        g.addColorStop(1, 'rgba(6,182,212,0)')
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2)
        ctx.fillStyle = g; ctx.fill()
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fillStyle = '#67e8f9'; ctx.fill()
      })

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.progress += p.speed
        if (p.progress >= 1) { particles.splice(i, 1); spawnParticle(); continue }
        const x = (p.fromX + (p.toX - p.fromX) * p.progress) * w
        const y = (p.fromY + (p.toY - p.fromY) * p.progress) * h
        const alpha = Math.sin(p.progress * Math.PI)
        ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = p.color === 'purple'
          ? `rgba(167,139,250,${alpha})`
          : `rgba(103,232,249,${alpha})`
        ctx.fill()
      }
    }

    draw()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
}

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#070b1a', color: '#e2e8f0' }}>

      {/* ── Header ── */}
      <header
        className="px-6 py-4 sticky top-0 z-50"
        style={{
          background: 'rgba(7,11,26,0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(124,58,237,0.2)',
        }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)' }}
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
              </svg>
            </div>
            <span className="text-xl font-bold" style={{ color: '#a78bfa' }}>SmartHire AI</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm" style={{ color: '#94a3b8' }}>
            <a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
          </nav>

          <Link
            href="/hr/login"
            className="px-5 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
              color: '#fff',
              boxShadow: '0 0 20px rgba(124,58,237,0.4)',
            }}
          >
            HR Login
          </Link>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section className="relative overflow-hidden px-6 pt-20 pb-0">
        {/* Glow blobs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(ellipse,rgba(124,58,237,0.18) 0%,transparent 70%)', filter: 'blur(40px)' }} />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(ellipse,rgba(6,182,212,0.12) 0%,transparent 70%)', filter: 'blur(60px)' }} />

        <div className="max-w-7xl mx-auto relative z-10">
          {/* Badge */}
          <div className="flex justify-center mb-6">
            <span
              className="px-4 py-1.5 rounded-full text-xs font-semibold tracking-widest uppercase"
              style={{
                background: 'rgba(124,58,237,0.15)',
                border: '1px solid rgba(124,58,237,0.4)',
                color: '#a78bfa',
              }}
            >
              AI-Powered Recruitment Platform
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-center text-3xl sm:text-5xl md:text-6xl font-extrabold leading-tight mb-6 tracking-tight">
            Hire Smarter with{' '}
            <span style={{
              background: 'linear-gradient(90deg,#a78bfa,#06b6d4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              Artificial Intelligence
            </span>
          </h1>

          <p className="text-center text-base md:text-xl max-w-2xl mx-auto mb-10 px-2" style={{ color: '#94a3b8' }}>
            No manual screening. AI analyzes every resume instantly and delivers
            only the best-fit candidates — straight to your dashboard.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
            <Link
              href="/hr/login"
              className="w-full sm:w-auto text-center px-8 py-4 rounded-xl font-semibold text-base sm:text-lg transition-all"
              style={{
                background: 'linear-gradient(135deg,#7c3aed,#06b6d4)',
                color: '#fff',
                boxShadow: '0 0 30px rgba(124,58,237,0.5)',
              }}
            >
              Post a Job as HR
            </Link>
            <button
              onClick={() => alert('To apply for a job, ask your HR team for the specific application link.')}
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold text-base sm:text-lg transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(167,139,250,0.3)',
                color: '#e2e8f0',
                backdropFilter: 'blur(8px)',
              }}
            >
              Apply as Candidate
            </button>
          </div>

          {/* Hero Image + Neural Network Animation */}
          <div
            className="relative rounded-2xl overflow-hidden mx-auto"
            style={{
              maxWidth: 900,
              border: '1px solid rgba(124,58,237,0.3)',
              boxShadow: '0 0 80px rgba(124,58,237,0.25), 0 0 0 1px rgba(255,255,255,0.05)',
            }}
          >
            <Image
              src="/home_page_img.jpeg"
              alt="AI Resume Screening"
              width={900}
              height={506}
              className="w-full h-auto block"
              priority
            />
            {/* Animated neural net overlay */}
            <div className="absolute inset-0" style={{ mixBlendMode: 'screen' }}>
              <NeuralNetworkCanvas />
            </div>
            {/* Bottom fade */}
            <div
              className="absolute bottom-0 left-0 right-0 h-24"
              style={{ background: 'linear-gradient(to bottom,transparent,#070b1a)' }}
            />
          </div>
        </div>
      </section>

      {/* ── Stats Bar ── */}
      <section className="px-6 py-14" id="features">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { value: '10x',   label: 'Faster Screening' },
            { value: '95%',   label: 'Match Accuracy' },
            { value: '0',     label: 'Manual Reviews' },
            { value: '<2 min',label: 'Result Delivery' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl p-6 text-center"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(124,58,237,0.2)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <p className="text-3xl font-extrabold mb-1" style={{
                background: 'linear-gradient(90deg,#a78bfa,#67e8f9)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {stat.value}
              </p>
              <p className="text-sm" style={{ color: '#64748b' }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="px-6 py-20" id="how-it-works">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">How It Works</h2>
            <p style={{ color: '#64748b' }}>Two paths. One intelligent system.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* For HR */}
            <div
              className="rounded-2xl p-8"
              style={{
                background: 'rgba(124,58,237,0.07)',
                border: '1px solid rgba(124,58,237,0.25)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div className="flex items-center gap-3 mb-8">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold">For HR Teams</h3>
              </div>
              <div className="space-y-6">
                {[
                  { step: '1', title: 'Create a Job Posting', desc: 'Fill in job title, description, required skills, and experience level.' },
                  { step: '2', title: 'Share the Link', desc: 'Get a unique application link to share with candidates via email or job boards.' },
                  { step: '3', title: 'Receive Top Candidates', desc: 'AI filters and scores every resume. You only see the candidates who qualify.' },
                ].map((item) => (
                  <div key={item.step} className="flex gap-4">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 mt-0.5"
                      style={{ background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)', color: '#a78bfa' }}
                    >
                      {item.step}
                    </div>
                    <div>
                      <p className="font-semibold">{item.title}</p>
                      <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* For Candidates */}
            <div
              className="rounded-2xl p-8"
              style={{
                background: 'rgba(6,182,212,0.06)',
                border: '1px solid rgba(6,182,212,0.2)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div className="flex items-center gap-3 mb-8">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg,#0891b2,#06b6d4)' }}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold">For Candidates</h3>
              </div>
              <div className="space-y-6">
                {[
                  { step: '1', title: 'Open the Link', desc: 'Click the job application link shared by the HR team — no account needed.' },
                  { step: '2', title: 'Upload Your Resume', desc: 'Submit your name, email, and upload your resume as a PDF file.' },
                  { step: '3', title: 'Get Instant Results via Email', desc: 'AI analyzes your resume and sends you the result within minutes.' },
                ].map((item) => (
                  <div key={item.step} className="flex gap-4">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 mt-0.5"
                      style={{ background: 'rgba(6,182,212,0.2)', border: '1px solid rgba(6,182,212,0.4)', color: '#67e8f9' }}
                    >
                      {item.step}
                    </div>
                    <div>
                      <p className="font-semibold">{item.title}</p>
                      <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section className="px-6 py-16">
        <div
          className="max-w-4xl mx-auto rounded-2xl p-6 sm:p-12 text-center"
          style={{
            background: 'linear-gradient(135deg,rgba(124,58,237,0.2),rgba(6,182,212,0.15))',
            border: '1px solid rgba(124,58,237,0.3)',
          }}
        >
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Ready to Transform Your Hiring?</h2>
          <p className="mb-8" style={{ color: '#94a3b8' }}>
            Join HR teams who let AI do the heavy lifting — faster, smarter, bias-free.
          </p>
          <Link
            href="/hr/login"
            className="inline-block px-10 py-4 rounded-xl font-semibold text-lg transition-all"
            style={{
              background: 'linear-gradient(135deg,#7c3aed,#06b6d4)',
              color: '#fff',
              boxShadow: '0 0 40px rgba(124,58,237,0.5)',
            }}
          >
            Get Started Free
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        className="px-6 py-8 mt-auto"
        style={{ borderTop: '1px solid rgba(124,58,237,0.15)', color: '#475569' }}
      >
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)' }}>
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
              </svg>
            </div>
            <span className="font-semibold" style={{ color: '#a78bfa' }}>SmartHire AI</span>
          </div>
          <p>
            Powered by <span className="text-white font-semibold">OpenAI</span>
            {' '}· &copy; {new Date().getFullYear()} SmartHire AI. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
