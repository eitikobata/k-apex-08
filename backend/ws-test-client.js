const { io } = require('socket.io-client');

const ACCESS_TOKEN = process.argv[2];
const BASE_URL = process.argv[3] || 'http://localhost:3000';

if (!ACCESS_TOKEN) {
  console.error('Uso: node ws-test-client.js <accessToken> [baseUrl]');
  process.exit(1);
}

console.log(`Conectando em ${BASE_URL}/console ...`);

const socket = io(`${BASE_URL}/console`, { auth: { token: ACCESS_TOKEN } });

socket.on('connect', () => console.log('conectado:', socket.id));
socket.on('connect_error', (err) => console.error('erro de conexão:', err.message));
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
console.log('  AUTONOMOUS ON');
