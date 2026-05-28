import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://cayjeqeleenizbdzrums.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheWplcWVsZWVuaXpiZHpydW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3OTE5NzUsImV4cCI6MjA5NTM2Nzk3NX0.xWF6mSMTYSL65S56FTUSWFN0udJSY_yzUedU2CwFwpw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export default supabase;
