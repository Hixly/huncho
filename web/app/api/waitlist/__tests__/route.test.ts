import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: () => ({ insert: insertMock }) }),
}));

import { POST } from '../route';

function req(body: unknown) {
  return new Request('http://test/api/waitlist', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

beforeEach(() => { insertMock.mockReset(); insertMock.mockResolvedValue({ error: null }); });

describe('POST /api/waitlist', () => {
  it('inserts a valid email', async () => {
    const res = await POST(req({ email: 'A@Example.com' }));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledWith({ email: 'a@example.com', source: 'huncho.tech' });
  });
  it('rejects an invalid email with 400', async () => {
    const res = await POST(req({ email: 'nope' }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });
  it('returns fake success when honeypot filled, without inserting', async () => {
    const res = await POST(req({ email: 'a@example.com', hp: 'bot' }));
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
  });
  it('treats duplicate email as success', async () => {
    insertMock.mockResolvedValue({ error: { code: '23505' } });
    const res = await POST(req({ email: 'a@example.com' }));
    expect(res.status).toBe(200);
  });
  it('returns 500 on other db errors without leaking details', async () => {
    insertMock.mockResolvedValue({ error: { code: '42P01', message: 'secret internals' } });
    const res = await POST(req({ email: 'a@example.com' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
  it('handles malformed JSON body with 400', async () => {
    const res = await POST(new Request('http://test/api/waitlist', { method: 'POST', body: '{nope' }));
    expect(res.status).toBe(400);
  });
});
