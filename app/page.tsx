'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type StepKey = 'face' | 'upscale' | 'colorize';

interface StepResult {
  name: string;
  status: string;
  note: string;
}

interface RestoreJobResult {
  after: string;
  steps: StepResult[];
  mock: boolean;
}

interface RestoreResponse {
  mode?: 'job' | 'preview';
  jobId?: string;
  preview?: string;
  resultId?: string;
  steps?: StepResult[];
  mock?: boolean;
  error?: string;
  purchaseRequired?: boolean;
}

interface RestoreJobStatus {
  status?: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: RestoreJobResult;
  error?: string;
}

interface EntitlementResponse {
  credits?: number;
  freeUsed?: number;
  freeLimit?: number;
  error?: string;
}

interface UnlockResponse {
  image?: string;
  error?: string;
}

interface Entitlement {
  credits: number;
  freeUsed: number;
  freeLimit: number;
}

interface Plan {
  id: string;
  amount: number;
  currency: string;
  label: string;
  kind: string;
  credits: number;
}

const PLANS: Plan[] = [
  {
    id: 'single',
    amount: 59900,
    currency: 'INR',
    label: 'One memorial photo - full restoration + human QA',
    kind: 'one-time',
    credits: 1,
  },
  {
    id: 'album',
    amount: 299900,
    currency: 'INR',
    label: 'Memorial album, up to 15 photos - full restoration + human QA',
    kind: 'one-time',
    credits: 15,
  },
];

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

function priceLabel(amount: number, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount / 100);
}

const JOB_POLL_MS = 1200;
const JOB_POLL_MAX_ATTEMPTS = 150;

async function pollRestoreJob(jobId: string): Promise<RestoreJobStatus> {
  for (let attempt = 0; attempt < JOB_POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`/api/restore/status?id=${encodeURIComponent(jobId)}`);
    const job: RestoreJobStatus = await res.json();
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
  }
  throw new Error('Restore is taking longer than expected - please try again shortly.');
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
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [steps, setSteps] = useState<Record<StepKey, boolean>>({ face: true, upscale: true, colorize: true });
  const [buyStatus, setBuyStatus] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshEntitlement = useCallback(async () => {
    try {
      const res = await fetch('/api/entitlement');
      const data: EntitlementResponse = await res.json();
      if (res.ok && typeof data.credits === 'number') {
        setEntitlement({ credits: data.credits, freeUsed: data.freeUsed ?? 0, freeLimit: data.freeLimit ?? 0 });
      }
    } catch {
    }
  }, []);

  useEffect(() => {
    refreshEntitlement();
  }, [refreshEntitlement]);

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
      setResultId(null);
      setLocked(false);
      setUnlockError(null);
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
    setBusy(true);
    setError(null);
    setAfter(null);
    setResultSteps(null);
    setResultId(null);
    setLocked(false);
    try {
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, steps }),
      });
      const data: RestoreResponse = await res.json();
      if (!res.ok) {
        setError(
          data.purchaseRequired
            ? 'Your free previews are used up. Choose a plan below to keep restoring.'
            : data.error || 'Restore failed',
        );
        return;
      }

      if (data.mode === 'job' && data.jobId) {
        const job = await pollRestoreJob(data.jobId);
        if (job.status !== 'succeeded' || !job.result) {
          throw new Error(job.error || 'Restore failed');
        }
        setAfter(job.result.after);
        setResultSteps(job.result.steps);
        setIsMock(job.result.mock);
        setLocked(false);
      } else if (data.mode === 'preview' && data.preview && data.resultId && data.steps) {
        setAfter(data.preview);
        setResultSteps(data.steps);
        setIsMock(!!data.mock);
        setResultId(data.resultId);
        setLocked(true);
      } else {
        throw new Error('Unexpected response from the restore service');
      }
      await refreshEntitlement();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    if (!resultId) return;
    const trimmedEmail = email.trim();
    const trimmedWhatsapp = whatsapp.trim();
    if (!trimmedEmail && !trimmedWhatsapp) {
      setUnlockError('Enter an email or WhatsApp number to unlock the full-resolution photo.');
      return;
    }
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resultId,
          email: trimmedEmail || undefined,
          whatsapp: trimmedWhatsapp || undefined,
        }),
      });
      const data: UnlockResponse = await res.json();
      if (!res.ok || !data.image) throw new Error(data.error || 'Could not unlock the full photo');
      setAfter(data.image);
      setLocked(false);
    } catch (err) {
      setUnlockError((err as Error).message);
    } finally {
      setUnlockBusy(false);
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
          await refreshEntitlement();
          const n = verify.credited;
          setBuyStatus(
            resp.mock
              ? `Unlocked ${n} restoration${n === 1 ? '' : 's'}. Test mode - no real charge.`
              : `Payment confirmed - ${n} restoration${n === 1 ? '' : 's'} added to your account.`,
          );
        } else {
          setBuyStatus('Payment could not be verified.');
        }
      };

      if (resp.mock_payment) {
        await finish(resp.mock_payment.payment_id, resp.mock_payment.signature);
        return;
      }

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

  const freeLeft = entitlement ? Math.max(0, entitlement.freeLimit - entitlement.freeUsed) : null;
  const entitlementLabel = !entitlement
    ? 'Checking your balance...'
    : entitlement.credits > 0
      ? `${entitlement.credits} paid restoration${entitlement.credits === 1 ? '' : 's'} ready`
      : (freeLeft ?? 0) > 0
        ? `${freeLeft} free preview${freeLeft === 1 ? '' : 's'} left`
        : 'Free previews used - see pricing below';
  const entitlementClass =
    entitlement && (entitlement.credits > 0 || (freeLeft ?? 0) > 0) ? 'badge ok' : 'badge warn';

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
          <span className="eyebrow">Memorial & legacy photo restoration</span>
          <h1>
            Bring back the photo <span className="gradient-text">of the one you miss</span>
          </h1>
          <p className="lead">
            Reviva restores faded, torn, and black-and-white photographs of the people who have
            passed - repairing faces, sharpening detail, and adding natural color so heirloom
            photos and family albums look the way you remember them.
          </p>
          <div className="row" style={{ justifyContent: 'center', maxWidth: 420, margin: '0 auto' }}>
            <a className="btn lg" href="#tool">
              Restore a photo free
            </a>
          </div>
          <p className="muted" style={{ marginTop: 14, fontSize: '0.9rem' }}>
            Free watermarked preview - unlock the full-resolution photo with just an email or WhatsApp number.
          </p>
        </section>

        <section className="section">
          <div className="card center">
            <span className="badge ok">Our guarantee</span>
            <h2 style={{ marginTop: 14 }}>A real person checks every face before delivery</h2>
            <p className="lead" style={{ margin: '12px auto 0' }}>
              Every restoration is reviewed by a human against the original photo. If the likeness
              is not right, we will redo it for free or refund you in full.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="card">
            <div className="grid cols-2" style={{ alignItems: 'center' }}>
              <div>
                <span className="badge">Before</span>
                <img
                  src={BEFORE_SVG}
                  alt="A faded, damaged heirloom photo before restoration"
                  style={{ width: '100%', borderRadius: 12, marginTop: 10, display: 'block' }}
                />
              </div>
              <div>
                <span className="badge ok">After</span>
                <img
                  src={AFTER_SVG}
                  alt="The same photo restored and colorized by Reviva"
                  style={{ width: '100%', borderRadius: 12, marginTop: 10, display: 'block' }}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="section center">
          <h2>How it works</h2>
          <p className="lead" style={{ margin: '0 auto 32px' }}>
            Three passes, one click, then a human check before it reaches you.
          </p>
          <div className="grid cols-3">
            <div className="card">
              <div className="badge">Step 1</div>
              <h3 style={{ marginTop: 12 }}>Restore the face</h3>
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
              <span className={entitlementClass}>{entitlementLabel}</span>
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
                      {locked && resultId ? (
                        <div style={{ marginTop: 14 }}>
                          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 10 }}>
                            This is a watermarked preview. Enter an email or WhatsApp number and
                            we will unlock the full-resolution photo, free.
                          </p>
                          <div className="field">
                            <label htmlFor="unlock-email">Email</label>
                            <input
                              id="unlock-email"
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="you@example.com"
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="unlock-whatsapp">or WhatsApp number</label>
                            <input
                              id="unlock-whatsapp"
                              type="text"
                              value={whatsapp}
                              onChange={(e) => setWhatsapp(e.target.value)}
                              placeholder="+91 98765 43210"
                            />
                          </div>
                          {unlockError && <p style={{ color: 'var(--err)', marginBottom: 10 }}>{unlockError}</p>}
                          <button className="btn" onClick={unlock} disabled={unlockBusy}>
                            {unlockBusy ? <span className="spinner" /> : null}
                            {unlockBusy ? 'Unlocking...' : 'Unlock full-resolution photo'}
                          </button>
                        </div>
                      ) : (
                        <a
                          className="btn secondary"
                          href={after}
                          download={`reviva-${fileName || 'restored.png'}`}
                          style={{ marginTop: 12 }}
                        >
                          Download result
                        </a>
                      )}
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
            <h2>Per-project pricing</h2>
            <p className="lead" style={{ margin: '0 auto 12px' }}>
              Free previews are unlocked with just an email or WhatsApp number. Need more
              restorations, or a whole album at once? Pay once - there is no subscription.
            </p>
            <p className="muted" style={{ margin: '0 auto 32px', fontSize: '0.85rem' }}>
              Prices are in Indian Rupees, charged via Razorpay. Checkout currently supports
              India only.
            </p>
          </div>
          <div className="grid cols-2">
            {PLANS.map((plan) => (
              <div className="card" key={plan.id}>
                <div className="badge">One-time</div>
                <div className="price" style={{ marginTop: 12 }}>
                  <span className="amt">{priceLabel(plan.amount, plan.currency)}</span>
                </div>
                <p className="muted" style={{ marginTop: 4 }}>{plan.label}</p>
                <ul className="pill-list">
                  <li>{plan.credits === 1 ? '1 photo, full restoration' : `Up to ${plan.credits} photos, full restoration`}</li>
                  <li>Face restore, upscale, and colorize</li>
                  <li>Human QA before delivery</li>
                </ul>
                <button className="btn" onClick={() => purchase(plan.id)} style={{ width: '100%' }}>
                  {plan.id === 'single' ? 'Restore one photo' : 'Restore an album'}
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
            Test mode locally - no real charge is made without live Razorpay keys.
          </p>
        </section>
      </div>

      <footer className="footer">
        <div className="container">
          Reviva - memorial and legacy photo restoration, checked by a person before it reaches you.
        </div>
      </footer>
    </main>
  );
}
