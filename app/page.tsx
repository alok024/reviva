'use client';

import { useCallback, useRef, useState } from 'react';

type StepKey = 'face' | 'upscale' | 'colorize';

interface StepResult {
  name: string;
  status: string;
  note: string;
}

interface RestoreResponse {
  after: string;
  steps: StepResult[];
  mock: boolean;
  error?: string;
}

interface Plan {
  id: string;
  amount: number;
  currency: string;
  label: string;
  kind: string;
}

// Static pricing mirror for the landing cards (server is the source of truth at checkout).
const PLANS: Plan[] = [
  { id: 'pack20', amount: 499, currency: 'USD', label: '$4.99 - 20 photos', kind: 'one-time' },
  { id: 'unlimited_month', amount: 900, currency: 'USD', label: '$9/mo - unlimited', kind: 'sub' },
];

// Self-contained before/after showcase drawn as inline SVG (no external assets).
const BEFORE_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#9a9a9a"/><circle cx="200" cy="120" r="70" fill="#c4c4c4"/><rect x="120" y="185" width="160" height="115" rx="20" fill="#b0b0b0"/><rect width="400" height="300" fill="url(#g)" opacity="0.25"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><g fill="#8a8a8a" opacity="0.5"><rect x="30" y="40" width="90" height="4"/><rect x="260" y="250" width="110" height="4"/></g></svg>`,
  );
const AFTER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#eaddc9"/><circle cx="200" cy="120" r="70" fill="#f0c9a6"/><circle cx="180" cy="110" r="8" fill="#3b2b22"/><circle cx="220" cy="110" r="8" fill="#3b2b22"/><path d="M175 145 q25 20 50 0" stroke="#a25b4b" stroke-width="5" fill="none"/><rect x="120" y="185" width="160" height="115" rx="20" fill="#e11d48"/><rect x="140" y="60" width="120" height="30" rx="12" fill="#6b4a2f"/></svg>`,
  );

function centsToPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [after, setAfter] = useState<string | null>(null);
  const [resultSteps, setResultSteps] = useState<StepResult[] | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [credits, setCredits] = useState(3);
  const [steps, setSteps] = useState<Record<StepKey, boolean>>({ face: true, upscale: true, colorize: true });
  const [buyStatus, setBuyStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback((file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image is larger than 10MB. Please pick a smaller file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result as string);
      setFileName(file.name);
      setAfter(null);
      setResultSteps(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  const toggleStep = (key: StepKey) => setSteps((s) => ({ ...s, [key]: !s[key] }));

  async function restore() {
    if (!image) {
      setError('Choose a photo first.');
      return;
    }
    if (!steps.face && !steps.upscale && !steps.colorize) {
      setError('Turn on at least one step.');
      return;
    }
    if (credits <= 0) {
      setError('You are out of free photos. Grab a pack below.');
      return;
    }
    setBusy(true);
    setError(null);
    setAfter(null);
    setResultSteps(null);
    try {
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, steps }),
      });
      const data: RestoreResponse = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      setAfter(data.after);
      setResultSteps(data.steps);
      setIsMock(data.mock);
      setCredits((c) => Math.max(0, c - 1));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function loadRazorpayScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Razorpay'));
      document.body.appendChild(s);
    });
  }

  async function purchase(planId: string) {
    setBuyStatus(null);
    setError(null);
    try {
      const orderRes = await fetch('/api/checkout/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const resp = await orderRes.json();
      if (!orderRes.ok) throw new Error(resp.error || 'Could not start checkout');

      const finish = async (payment_id: string, signature: string) => {
        const verifyRes = await fetch('/api/checkout/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: resp.order_id, payment_id, signature }),
        });
        const verify = await verifyRes.json();
        if (verify.ok) {
          setCredits((c) => (planId === 'unlimited_month' ? 9999 : c + 20));
          setBuyStatus('Unlocked! Credits added. Test mode - no real charge.');
        } else {
          setBuyStatus('Payment could not be verified.');
        }
      };

      if (resp.mock_payment) {
        // Local test mode: complete without opening a real modal, no charge.
        await finish(resp.mock_payment.payment_id, resp.mock_payment.signature);
        return;
      }

      // Real keys present: open the Razorpay checkout modal.
      await loadRazorpayScript();
      const rzp = new window.Razorpay!({
        key: resp.key,
        order_id: resp.order_id,
        amount: resp.amount,
        currency: resp.currency,
        name: 'Reviva',
        description: resp.label,
        handler: (r: { razorpay_payment_id: string; razorpay_signature: string }) => {
          void finish(r.razorpay_payment_id, r.razorpay_signature);
        },
      });
      rzp.open();
    } catch (err) {
      setBuyStatus((err as Error).message);
    }
  }

  return (
    <main>
      <nav className="nav">
        <div className="brand">
          <span className="dot" />
          Reviva
        </div>
        <a className="btn ghost" href="#tool">
          Restore a photo
        </a>
      </nav>

      <div className="container">
        <section className="hero">
          <span className="eyebrow">Photo restoration</span>
          <h1>
            Bring your old photos <span className="gradient-text">back to life</span>
          </h1>
          <p className="lead">
            Faded, scratched, or black-and-white - Reviva restores faces, sharpens detail, and adds natural color so the
            people you love look the way you remember them.
          </p>
          <div className="row" style={{ justifyContent: 'center', maxWidth: 420, margin: '0 auto' }}>
            <a className="btn lg" href="#tool">
              Restore your photo free
            </a>
          </div>
          <p className="muted" style={{ marginTop: 14, fontSize: '0.9rem' }}>
            3 free photos - no sign-up needed
          </p>
        </section>

        <section className="section">
          <div className="card">
            <div className="grid cols-2" style={{ alignItems: 'center' }}>
              <div>
                <span className="badge">Before</span>
                <img
                  src={BEFORE_SVG}
                  alt="Faded black and white photo before restoration"
                  style={{ width: '100%', borderRadius: 12, marginTop: 10, display: 'block' }}
                />
              </div>
              <div>
                <span className="badge ok">After</span>
                <img
                  src={AFTER_SVG}
                  alt="Restored and colorized photo after Reviva"
                  style={{ width: '100%', borderRadius: 12, marginTop: 10, display: 'block' }}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="section center">
          <h2>How it works</h2>
          <p className="lead" style={{ margin: '0 auto 32px' }}>
            Three passes, one click. Every step is optional.
          </p>
          <div className="grid cols-3">
            <div className="card">
              <div className="badge">Step 1</div>
              <h3 style={{ marginTop: 12 }}>Restore faces</h3>
              <p className="muted">Rebuilds blurred and damaged faces so expressions and detail come back sharp.</p>
            </div>
            <div className="card">
              <div className="badge">Step 2</div>
              <h3 style={{ marginTop: 12 }}>Upscale and clean</h3>
              <p className="muted">Removes noise and scratches, then enlarges to a crisp, print-ready resolution.</p>
            </div>
            <div className="card">
              <div className="badge">Step 3</div>
              <h3 style={{ marginTop: 12 }}>Add natural color</h3>
              <p className="muted">Colorizes black-and-white photos with lifelike, period-accurate tones.</p>
            </div>
          </div>
        </section>

        <section className="section" id="tool">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <h2 style={{ margin: 0 }}>Restore a photo</h2>
              <span className={credits > 0 ? 'badge ok' : 'badge warn'}>
                {credits >= 9999 ? 'Unlimited' : `${credits} free photos left`}
              </span>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                marginTop: 18,
                border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                padding: '36px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: dragOver ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--bg-soft)',
                transition: 'background .15s, border-color .15s',
              }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>Drag and drop a photo here</p>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                or click to browse - JPG or PNG, up to 10MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
                style={{ display: 'none' }}
              />
            </div>

            {fileName && (
              <p className="muted" style={{ marginTop: 10, fontSize: '0.9rem' }}>
                Selected: {fileName}
              </p>
            )}

            <div className="row" style={{ marginTop: 18 }}>
              {(['face', 'upscale', 'colorize'] as StepKey[]).map((key) => {
                const labels: Record<StepKey, string> = {
                  face: 'Face restore',
                  upscale: 'Upscale',
                  colorize: 'Colorize',
                };
                const on = steps[key];
                return (
                  <button
                    key={key}
                    type="button"
                    className={on ? 'btn' : 'btn secondary'}
                    onClick={() => toggleStep(key)}
                  >
                    {on ? 'On' : 'Off'} - {labels[key]}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 18 }}>
              <button className="btn lg" onClick={restore} disabled={busy || !image}>
                {busy ? <span className="spinner" /> : null}
                {busy ? 'Restoring...' : 'Restore photo'}
              </button>
            </div>

            {error && (
              <p style={{ color: 'var(--err)', marginTop: 14 }}>{error}</p>
            )}

            {(image || after) && (
              <div className="grid cols-2" style={{ marginTop: 24 }}>
                <div>
                  <span className="badge">Before</span>
                  {image ? (
                    <img
                      src={image}
                      alt="Original"
                      style={{ width: '100%', borderRadius: 12, marginTop: 10, display: 'block' }}
                    />
                  ) : (
                    <p className="muted">No image yet.</p>
                  )}
                </div>
                <div>
                  <span className="badge ok">After</span>
                  {after ? (
                    <>
                      <img
                        src={after}
                        alt="Restored"
                        style={{ width: '100%', borderRadius: 12, marginTop: 10, display: 'block' }}
                      />
                      <a className="btn secondary" href={after} download={`reviva-${fileName || 'restored.png'}`} style={{ marginTop: 12 }}>
                        Download result
                      </a>
                    </>
                  ) : (
                    <p className="muted" style={{ marginTop: 10 }}>
                      Your restored photo will appear here.
                    </p>
                  )}
                </div>
              </div>
            )}

            {resultSteps && (
              <div style={{ marginTop: 18 }}>
                <ul className="pill-list">
                  {resultSteps.map((s) => (
                    <li key={s.name}>
                      {s.name} - {s.status}
                      {s.note === 'mock' ? ' (mock)' : ''}
                    </li>
                  ))}
                </ul>
                {isMock && (
                  <p className="muted" style={{ fontSize: '0.85rem' }}>
                    Running in demo mode - the original is echoed back. Add a REPLICATE_API_TOKEN to enable real
                    restoration.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="center">
            <h2>Simple pricing</h2>
            <p className="lead" style={{ margin: '0 auto 32px' }}>
              Start with 3 free photos. Buy a pack when you have a whole album to bring back.
            </p>
          </div>
          <div className="grid cols-2">
            {PLANS.map((plan) => (
              <div className="card" key={plan.id}>
                <div className="badge">{plan.kind === 'sub' ? 'Subscription' : 'One-time'}</div>
                <div className="price" style={{ marginTop: 12 }}>
                  <span className="amt">{centsToPrice(plan.amount, plan.currency)}</span>
                  <span className="muted">{plan.kind === 'sub' ? '/mo' : ''}</span>
                </div>
                <p className="muted" style={{ marginTop: 4 }}>{plan.label}</p>
                <ul className="pill-list">
                  {plan.id === 'pack20' ? (
                    <>
                      <li>20 full-quality restorations</li>
                      <li>Face restore, upscale, and colorize</li>
                      <li>Download in original resolution</li>
                    </>
                  ) : (
                    <>
                      <li>Unlimited restorations every month</li>
                      <li>Priority processing</li>
                      <li>Cancel anytime</li>
                    </>
                  )}
                </ul>
                <button className="btn" onClick={() => purchase(plan.id)} style={{ width: '100%' }}>
                  {plan.id === 'pack20' ? 'Buy 20-photo pack' : 'Go unlimited'}
                </button>
              </div>
            ))}
          </div>
          {buyStatus && (
            <p className="center" style={{ marginTop: 18, color: 'var(--ok)' }}>
              {buyStatus}
            </p>
          )}
          <p className="center muted" style={{ marginTop: 10, fontSize: '0.85rem' }}>
            Test mode - no real charge is made locally.
          </p>
        </section>
      </div>

      <footer className="footer">
        <div className="container">Reviva - restore and colorize old photos. Your memories, brought back.</div>
      </footer>
    </main>
  );
}
