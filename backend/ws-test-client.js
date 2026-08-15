const { io } = require('socket.io-client');

const ACCESS_TOKEN = process.argv[2];
if (!ACCESS_TOKEN) {
  console.error('Uso: node ws-test-client.js <accessToken>');
  process.exit(1);
}

const socket = io('http://localhost:3000/console', { auth: { token: ACCESS_TOKEN } });

socket.on('connect', () => console.log('conectado:', socket.id));
socket.on('auth_error', (e) => console.error('auth_error:', e));
socket.on('command_result', (r) => console.log('command_result:', r));
socket.on('command_error', (e) => console.error('command_error:', e));

['INCIDENT_AWAITING_OPERATOR', 'AUTONOMOUS_MODE_CHANGED', 'ROGUE_AI_TRANSITION', 'ROGUE_AI_RESOLVED_AUTONOMOUSLY'].forEach((evt) => {
  socket.on(evt, (payload) => console.log(`[evento] ${evt}:`, payload));
});

process.stdin.on('data', (chunk) => {
  const raw = chunk.toString().trim();
  if (raw) socket.emit('command', { raw });
});

console.log('Digite um comando de terminal e enter, ex:');
console.log('  CONFIRM SPLICE //<incidentId>');

const AUTO_SOLVE = process.argv.includes('--auto-solve');

if (AUTO_SOLVE) {
  socket.on('INCIDENT_AWAITING_OPERATOR', async (payload) => {
    if (!payload.rogueAi || !payload.rogueAiIncidentId) return;
    const id = payload.rogueAiIncidentId;
    console.log(`\n[auto-solve] Rogue AI detectado: ${id} — resolvendo sozinho...`);

    for (const step of ['ISOLATE', 'TRACE', 'PURGE --confirm']) {
      await new Promise((r) => setTimeout(r, 800));
      const cmd = `${step} //${id}`;
      console.log(`[auto-solve] enviando: ${cmd}`);
      socket.emit('command', { raw: cmd });
      await new Promise((r) => setTimeout(r, 800));
    }
  });
}

console.log('  AUTONOMOUS ON');
