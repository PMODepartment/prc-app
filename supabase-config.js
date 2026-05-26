/**
 * supabase-config.js
 * Replace firebase-config.js with this file.
 * 
 * SETUP STEPS:
 * 1. Go to https://supabase.com → New Project → note your Project URL and anon key
 * 2. Replace the two constants below with your real values
 * 3. Run the SQL schema in /data/supabase-schema.sql in the Supabase SQL Editor
 * 4. Enable Email/Password auth in Authentication → Providers
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';  // ← replace
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';              // ← replace

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export default supabase;
