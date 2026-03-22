'use strict';

const express   = require('express');
const http      = require('http');
const { Server} = require('socket.io');
const path      = require('path');
const crypto    = require('crypto');

const app    = express();
const httpSv = http.createServer(app);
const io     = new Server(httpSv, {
  transports: ['websocket'],
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Words ──────────────────────────────────────────────────────────────────────
const WORDS = [
  'КОШКА','СОБАКА','ДОМ','МИР','НЕБО','ЗЕМЛЯ','ВОДА','ОГОНЬ','ВЕТЕР','ЛИСТ',
  'ДЕРЕВО','ГОРА','РЕКА','МОРЕ','ЗВЕЗДА','ЛУНА','СОЛНЦЕ','НОЧЬ','ДЕНЬ','ВРЕМЯ',
  'ЖИЗНЬ','СМЕРТЬ','ЛЮБОВЬ','СИЛА','ВЛАСТЬ','ДЕНЬГИ','ВОЙНА','КНИГА','СЛОВО','ЯЗЫК',
  'ГОЛОС','МУЗЫКА','ПЕСНЯ','ТЕАТР','КИНО','ИГРА','СПОРТ','ШКОЛА','ГОРОД','СТРАНА',
  'НАРОД','СЕМЬЯ','БРАТ','СЕСТРА','МАТЬ','ОТЕЦ','СЫН','ДОЧЬ','ДРУГ','ВРАГ',
  'КОРОЛЬ','ЗАМОК','МЕЧ','ЧЕРТ','СТРЕЛА','КОРАБЛЬ','КАПИТАН','ПИРАТ','РЫБАК',
  'РЫБА','ПТИЦА','ОРЁЛ','МЕДВЕДЬ','ВОЛК','ЛИСА','КОНЬ','ОЛЕНЬ','ЛЕВ','ТИГР',
  'ЗМЕЯ','ПАУК','ПЧЕЛА','БАБОЧКА','ЦВЕТОК','РОЗА','ТРАВА','ЛЕС','ПОЛЕ','КАМЕНЬ',
  'ЗОЛОТО','СЕРЕБРО','ЖЕЛЕЗО','СТЕКЛО','БУМАГА','РУЧКА','КАРАНДАШ','СТОЛ','СТУЛ','ОКНО',
  'ДВЕРЬ','КРЫША','СТЕНА','КУХНЯ','КОМНАТА','ДИВАН','КРОВАТЬ','ЗЕРКАЛО','ЛАМПА','ЧАСЫ',
  'ТЕЛЕФОН','КОМПЬЮТЕР','ИНТЕРНЕТ','СЕТЬ','ЭКРАН','КНОПКА','МАШИНА','ПОЕЗД','САМОЛЁТ','РАКЕТА',
  'МОСТ','ДОРОГА','УЛИЦА','ПАРК','ПЛОЩАДЬ','РЫНОК','МАГАЗИН','БАНК','БОЛЬНИЦА','ПОЛИЦИЯ',
  'АРМИЯ','ФЛАГ','ЗАКОН','СУД','ТЮРЬМА','СВОБОДА','НАУКА','ОПЫТ','ТАЙНА','ЗАГАДКА',
  'КЛЮЧ','СЕЙФ','МАСКА','ТЕНЬ','СОН','ПАМЯТЬ','ИДЕЯ','ПЛАН','КАРТА','КОМПАС',
  'ПУТЬ','ЦЕЛЬ','ПОБЕДА','ПОРАЖЕНИЕ','БОРЬБА','ПОКОЙ','ПРАЗДНИК','ПОДАРОК','ТОРТ','ШАРИК',
  'КЛОУН','ЦИРК','МАГ','ФОКУС','ШАХМАТЫ','МЯЧ','ГОНКА','ЧЕМПИОН','МЕДАЛЬ','ТРОФЕЙ',
  'ДОКТОР','УЧИТЕЛЬ','ПОВАР','ПИЛОТ','АКТЁР','ХУДОЖНИК','ПОЭТ','ПИСАТЕЛЬ','МОЛОКО','ХЛЕБ',
  'СЫР','МАСЛО','ЯЙЦО','МЯСО','СУП','КОФЕ','ЧАЙ','ОГУРЕЦ','ПОМИДОР','ЯБЛОКО',
  'ГРУША','ЛИМОН','АПЕЛЬСИН','ВИНОГРАД','АРБУЗ','КЛУБНИКА','ПАЛЬТО','ШАПКА','ШАРФ','ТУФЛИ',
  'САПОГИ','ПЛАТЬЕ','КОСТЮМ','РУБАШКА','ДЖИНСЫ','ОКЕАН','ПУСТЫНЯ','ДЖУНГЛИ','ВУЛКАН','ОСТРОВ',
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function genId() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }

// Assign teams + captains RANDOMLY at game start (not at join time)
function assignTeamsAndRoles(players) {
  const order = shuffle(players.map((_, i) => i));
  const half  = Math.ceil(order.length / 2);
  order.forEach((idx, i) => {
    players[idx].team = i < half ? 'red' : 'blue';
    players[idx].role = 'operative';
  });
  const reds  = players.filter(p => p.team === 'red');
  const blues = players.filter(p => p.team === 'blue');
  if (reds.length)  reds[  Math.floor(Math.random() * reds.length)].role  = 'captain';
  if (blues.length) blues[ Math.floor(Math.random() * blues.length)].role = 'captain';
}

function initGame(numPlayers) {
  const first = Math.random() < 0.5 ? 'red' : 'blue';
  const words = shuffle([...new Set(WORDS)]).slice(0, 25);
  const types = [
    ...Array(first === 'red' ? 9 : 8).fill('red'),
    ...Array(first === 'blue' ? 9 : 8).fill('blue'),
    ...Array(7).fill('neutral'),
    'assassin',
  ];
  // Assign figure index for client-side portrait variety
  return {
    cards:       shuffle(types).map((type, i) => ({
      word:   words[i],
      type,
      revealed: false,
      fig:    (Math.random() * 4) | 0,   // 0-3, client picks portrait variant
    })),
    currentTeam: first,
    redLeft:     first === 'red' ? 9 : 8,
    blueLeft:    first === 'blue' ? 9 : 8,
    winner:      null,
    winReason:   '',
  };
}

function cardView(card, role) {
  if (card.revealed || role === 'captain') return { ...card };
  return { word: card.word, revealed: false, type: 'unknown', fig: card.fig };
}

function pushState(room) {
  for (const p of room.players) {
    const sock = io.sockets.sockets.get(p.id);
    if (!sock) continue;
    const gs = room.gameState;
    sock.emit('state', {
      cards:       gs.cards.map(c => cardView(c, p.role)),
      currentTeam: gs.currentTeam,
      redLeft:     gs.redLeft,
      blueLeft:    gs.blueLeft,
      winner:      gs.winner,
      winReason:   gs.winReason,
      myTeam:      p.team,
      myRole:      p.role,
      players:     room.players.map(x => ({
        name:   x.name,
        team:   x.team,
        role:   x.role,
        online: !!io.sockets.sockets.get(x.id),
      })),
    });
  }
}

function pushLobby(room) {
  io.to(room.id).emit('lobby', {
    roomId:   room.id,
    players:  room.players.map(p => ({ name: p.name })),
    hostName: room.players.find(p => p.id === room.host)?.name || '',
  });
}

// ── Rooms ──────────────────────────────────────────────────────────────────────
const rooms = new Map();

io.on('connection', sock => {

  sock.on('create', ({ name }) => {
    if (!name?.trim()) return;
    const roomId = genId();
    // No team/role yet — assigned at game start
    const player = { id: sock.id, name: name.trim(), team: null, role: null };
    const room   = { id: roomId, host: sock.id, players: [player], started: false, gameState: null };
    rooms.set(roomId, room);
    sock.join(roomId);
    sock.data = { roomId };
    sock.emit('joined', { roomId, isHost: true });
    pushLobby(room);
  });

  sock.on('join', ({ roomId, name }) => {
    const id   = (roomId || '').toUpperCase().trim();
    const room = rooms.get(id);
    if (!room)         { sock.emit('err', 'Комната не найдена'); return; }
    if (!name?.trim()) { sock.emit('err', 'Введите имя'); return; }

    if (room.started) {
      const ex = room.players.find(p => p.name === name.trim() && !io.sockets.sockets.get(p.id));
      if (ex) {
        ex.id = sock.id;
        sock.join(id);
        sock.data = { roomId: id };
        sock.emit('joined', { roomId: id, isHost: room.host === ex.id });
        sock.emit('game_started');
        pushState(room);
        return;
      }
      sock.emit('err', 'Игра уже идёт. Для переподключения введите то же имя.');
      return;
    }

    const player = { id: sock.id, name: name.trim(), team: null, role: null };
    room.players.push(player);
    sock.join(id);
    sock.data = { roomId: id };
    sock.emit('joined', { roomId: id, isHost: false });
    pushLobby(room);
  });

  sock.on('start', () => {
    const { roomId } = sock.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.host !== sock.id || room.started) return;
    if (room.players.length < 2) { sock.emit('err', 'Нужен минимум 2 игрока'); return; }

    // Randomly assign teams and captains NOW
    assignTeamsAndRoles(room.players);

    room.started   = true;
    room.gameState = initGame(room.players.length);
    io.to(roomId).emit('game_started');
    pushState(room);
  });

  sock.on('reveal', ({ index }) => {
    const { roomId } = sock.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room?.started) return;
    const gs = room.gameState;
    if (gs.winner) return;
    const p = room.players.find(x => x.id === sock.id);
    if (!p || p.team !== gs.currentTeam) return;
    const teamSize = room.players.filter(x => x.team === gs.currentTeam).length;
    if (p.role !== 'operative' && teamSize > 1) return;
    const card = gs.cards[index];
    if (!card || card.revealed) return;

    card.revealed = true;
    if (card.type === 'red')  gs.redLeft--;
    if (card.type === 'blue') gs.blueLeft--;

    if (card.type === 'assassin') {
      gs.winner    = gs.currentTeam === 'red' ? 'blue' : 'red';
      gs.winReason = `${gs.currentTeam === 'red' ? 'Красные' : 'Синие'} открыли убийцу!`;
    } else if (gs.redLeft  === 0) {
      gs.winner = 'red';  gs.winReason = 'Красные открыли все свои слова!';
    } else if (gs.blueLeft === 0) {
      gs.winner = 'blue'; gs.winReason = 'Синие открыли все свои слова!';
    } else if (card.type !== gs.currentTeam) {
      gs.currentTeam = gs.currentTeam === 'red' ? 'blue' : 'red';
    }

    pushState(room);
  });

  sock.on('end_turn', () => {
    const { roomId } = sock.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room?.started) return;
    const gs = room.gameState;
    if (gs.winner) return;
    const p = room.players.find(x => x.id === sock.id);
    if (!p || p.team !== gs.currentTeam) return;
    gs.currentTeam = gs.currentTeam === 'red' ? 'blue' : 'red';
    pushState(room);
  });

  sock.on('restart', () => {
    const { roomId } = sock.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.host !== sock.id) return;
    // Re-assign teams randomly again
    assignTeamsAndRoles(room.players);
    room.gameState = initGame(room.players.length);
    io.to(roomId).emit('game_started');
    pushState(room);
  });

  sock.on('disconnect', () => {
    const { roomId } = sock.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.started) {
      room.players = room.players.filter(p => p.id !== sock.id);
      if (room.players.length === 0) { rooms.delete(roomId); return; }
      if (room.host === sock.id) room.host = room.players[0].id;
      pushLobby(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpSv.listen(PORT, () => console.log(`Коднеймс запущен → http://localhost:${PORT}`));
