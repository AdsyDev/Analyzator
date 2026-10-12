# TikTok Ads

**Ce aduce:** pe zi și pe campanie: **cost**, **afișări**, **clickuri** și **conversii**, în moneda advertiserului. Ultimele 35 de zile se reimportă la fiecare rulare.

**Plug and play:** după configurarea o singură dată a agenției, fiecare client se conectează cu **„Conectează cu TikTok”**.

## O singură dată, pentru agenție (echipa tehnică)

1. [business-api.tiktok.com](https://business-api.tiktok.com) → **My Apps → Create App** (TikTok for Business Developers):
   - permisiunile **Ad Account Management** și **Reporting**;
   - **Advertiser redirect URL:** `https://<proiect>.supabase.co/functions/v1/oauth/callback/tiktok_ads`.

   Aprobarea aplicației de către TikTok durează de obicei câteva zile.
2. **Secrete:**
   - Supabase → Edge Functions → Secrets: `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` (plus `APP_BASE_URL` și `ANALYZATOR_APP_ORIGIN`, ca la Google Ads);
   - GitHub → environment `staging`: `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`.

## Pentru fiecare client (din aplicație)

1. Pagina site-ului (Administrare → Clienți și site-uri → **Editează și surse**) → cardul **TikTok Ads** → **Conectează** → pasul 1 → **Conectează cu TikTok**.
2. Te loghezi în TikTok for Business, bifezi **advertiserii clientului** și confirmi. Revii în pagina site-ului cu „TikTok Ads a fost conectat”; cardul arată câte conturi au fost autorizate.

## Pentru fiecare brand

**„Adaugă conexiune”** → **TikTok Ads** → **Advertiser ID**-ul brandului (în TikTok Ads Manager, sub numele contului; doar cifre). Advertiserul trebuie să fie printre cei bifați la conectare.

## Rulare și verificare

GitHub → Actions → **tiktok-weekly** → Run workflow; automat marțea, după `CONNECTOR_TIKTOK_ENABLED = true`. Tokenul TikTok expiră zilnic și se reînnoiește automat la fiecare rulare. După un an, TikTok cere o nouă conectare.

## Probleme frecvente

| Simptom | Cauză | Soluție |
|---|---|---|
| „Conectarea TikTok nu e configurată pe server” | Lipsesc `TIKTOK_APP_ID` / `TIKTOK_APP_SECRET` în Supabase | Pasul 2 de la agenție. |
| `not_connected`: „Reconectează contul TikTok” | Refresh token refuzat (revocat sau mai vechi de un an) | Conectează din nou. |
| `permission_denied` | Advertiserul nu a fost bifat la conectare | Reconectează și bifează-l. |
| `invalid_account_id` | Advertiser ID cu litere sau spații | Doar cifrele. |
