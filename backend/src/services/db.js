const { createClient } = require('@supabase/supabase-js');
const settings = require('../config/settings');

if (!settings.supabaseUrl || !settings.supabaseAnonKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
}

const supabase = createClient(settings.supabaseUrl, settings.supabaseAnonKey);

module.exports = supabase;
