import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('请在 .env.local 文件中配置 Supabase URL 和 Key')
}

export const supabase = createClient(supabaseUrl, supabaseKey)