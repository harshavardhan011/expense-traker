const fs = require('fs');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const settings = require('./config/settings');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function getRedirectUri(port) {
  return `http://${settings.oauthRedirectHost}:${port}/oauth2callback`;
}

async function authorize() {
  if (!fs.existsSync(settings.credentialsPath)) {
    throw new Error(
      `credentials.json not found at ${settings.credentialsPath}\n` +
      'Download it from Google Cloud Console → APIs & Services → Credentials'
    );
  }

  const credentials = JSON.parse(fs.readFileSync(settings.credentialsPath, 'utf8'));
  const { client_secret, client_id } = credentials.installed || credentials.web;

  // Use ephemeral port to avoid EADDRINUSE
  const port = await getFreePort();
  const redirectUri = getRedirectUri(port);

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  // Return existing token if valid
  if (fs.existsSync(settings.tokenPath)) {
    const token = JSON.parse(fs.readFileSync(settings.tokenPath, 'utf8'));
    oAuth2Client.setCredentials(token);
    // Refresh if expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      const { credentials: newToken } = await oAuth2Client.refreshAccessToken();
      fs.writeFileSync(settings.tokenPath, JSON.stringify(newToken, null, 2));
      oAuth2Client.setCredentials(newToken);
    }
    return oAuth2Client;
  }

  // First-time auth flow
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('Opening browser for OAuth consent...');
  console.log('If browser does not open, visit:\n', authUrl);
  await openBrowser(authUrl);

  const code = await waitForAuthCode(port);

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(settings.tokenPath, JSON.stringify(tokens, null, 2));
  console.log('Token saved to', settings.tokenPath);

  return oAuth2Client;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, settings.oauthRedirectHost, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function waitForAuthCode(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const { query } = url.parse(req.url, true);
      if (query.error) {
        res.end('Auth failed: ' + query.error);
        server.close();
        reject(new Error('OAuth error: ' + query.error));
        return;
      }
      if (query.code) {
        res.end('<h2>Authentication successful! You can close this tab.</h2>');
        server.close();
        resolve(query.code);
      }
    });

    server.listen(port, settings.oauthRedirectHost, () => {
      console.log(`Waiting for OAuth callback on port ${port}...`);
    });

    server.on('error', (err) => {
      reject(new Error(`OAuth server error: ${err.message}`));
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timeout — no response within 2 minutes'));
    }, 120_000);
  });
}

async function openBrowser(url) {
  const { exec } = require('child_process');
  const platform = process.platform;
  const cmd =
    platform === 'win32' ? `start "" "${url}"` :
    platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) console.warn('Could not open browser:', err.message); });
}

module.exports = { authorize };

// Run directly: node src/auth.js
if (require.main === module) {
  authorize()
    .then(() => console.log('Authorization complete.'))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
