https://github.com/rubaahmedkhan/SmartHire-AI.git



  Ab Hugging Face Space mein backend push karo:                                                                         
  # HF Space clone karo (alag folder mein)
  cd C:/Users/DeLL/Desktop
  git clone https://huggingface.co/spaces/RubaKhan242/AIproject
  cd AIproject

  # Backend files copy karo
  xcopy /E /I D:\Resume_Project\backend\* .

  # Push karo
  git add .
  git commit -m "Add SmartHire AI FastAPI backend"
  git push

  Push hone ke baad backend URL hogi:
  https://rubakhan242-aiproject.hf.space

  ---
  Ab Vercel pe frontend deploy karo:

  1. vercel.com → New Project
  2. Import Git Repository → rubaahmedkhan/SmartHire-AI
  3. Root Directory → frontend set karo
  4. Environment Variables add karo:
    - NEXT_PUBLIC_SUPABASE_URL = https://ekwmqdpezuexbiqpmpgb.supabase.co
    - NEXT_PUBLIC_SUPABASE_ANON_KEY = (.env.local se copy karo)
    - NEXT_PUBLIC_API_URL = https://rubakhan242-aiproject.hf.space
  5. Deploy click karo

  HF Space push ho jaye to batao — final working URL de denge!

✻ Brewed for 1m 49s

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────>                