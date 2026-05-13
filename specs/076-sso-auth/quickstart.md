# Quickstart: SSO Authentication

## Prerequisites

- `WAVE_ADMIN_URL` environment variable set to your wave-admin instance
- wave-admin running with at least one SSO provider configured
- Browser accessible from the machine running Wave (for local flow)

## Local Machine Flow

1. **Set environment variable**:
   ```bash
   export WAVE_ADMIN_URL=https://wave-admin.example.com
   ```

2. **Start Wave**:
   ```bash
   wave
   ```

3. **Login**:
   ```
   /login
   ```

4. **Browser opens** → Complete SSO login on wave-admin

5. **Browser redirects** to `http://127.0.0.1:{port}?code=...` → Wave exchanges code for JWT automatically

6. **Verify**:
   ```
   /status    # Should show wave-admin URL as the API endpoint
   ```

7. **Logout**:
   ```
   /login     # Shows current auth status
   Press Enter → Logout
   ```
   Or:
   ```
   /logout    # Direct logout command
   ```

## Remote Server Flow (SSH)

1. **SSH to remote server** (no port forwarding needed)

2. **Start Wave**:
   ```bash
   wave
   ```

3. **Login**:
   ```
   /login
   ```

4. **Copy the displayed URL** and open it in your **local** browser

5. **Complete SSO login** on wave-admin

6. **Browser redirects** to `http://127.0.0.1:{port}?code=abc123` — the page shows "Connection refused" but **the authorization code is visible in the URL bar**

7. **Copy the authorization code** from the URL bar (the `code=` parameter value)

8. **Paste the code** into the terminal where Wave is running → Press Enter → Wave exchanges it for a JWT

9. **Verify**:
   ```
   /status    # Should show wave-admin URL
   ```

## Troubleshooting

### "WAVE_ADMIN_URL is not set"
Set the environment variable in your shell:
```bash
export WAVE_ADMIN_URL=https://wave-admin.example.com
```

### "No SSO providers available"
Configure SSO providers in wave-admin via environment variables:
```bash
SSO_PROVIDERS=company-sso
SSO_company_sso_ISSUER_URL=https://sso.example.com
SSO_company_sso_CLIENT_ID=xxx
SSO_company_sso_CLIENT_SECRET=xxx
```

### Token expired after 8 hours
wave-admin JWT defaults to 8-hour expiry. Re-run `/login` to get a fresh authorization code and exchange for a new token.

### "Connection refused" on browser redirect
Expected on remote servers. Copy the authorization code from the browser URL bar and paste into the terminal.
