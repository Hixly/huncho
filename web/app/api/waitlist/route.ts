import { NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/validate';
import { getSupabase } from '@/lib/supabase';

export async function POST(req: Request) {
  let body: { email?: unknown; hp?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }

  // Honeypot: bots fill it → pretend success, store nothing.
  if (typeof body.hp === 'string' && body.hp.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ ok: false, error: 'Enter a valid email' }, { status: 400 });
  }

  const { error } = await getSupabase().from('waitlist').insert({ email, source: 'huncho.tech' });
  if (error && error.code !== '23505') {
    // 23505 = unique violation → already on the list → success (idempotent, no enumeration)
    return NextResponse.json({ ok: false, error: 'Something failed — try again' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
