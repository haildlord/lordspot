import { createClient } from '@supabase/supabase-js';

// Get these from your Supabase Dashboard -> Settings -> API
const supabaseUrl = 'https://gnrbfebmnoohxlrpqwkg.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImducmJmZWJtbm9vaHhscnBxd2tnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjEwNjcsImV4cCI6MjA5MjY5NzA2N30.Ga9-e6gSpXniqOgf-kCAsf3rnDglphfB505-jYQmWlM';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);