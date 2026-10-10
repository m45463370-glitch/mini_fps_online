const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 20000, pingTimeout: 45000 });
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const publicQueue = [];
const MAX_PLAYERS = 8;
const cleanName = value => String(value || 'Player').replace(/[<>\r\n]/g, '').trim().slice(0, 16) || 'Player';
function code() { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<5;i++) s += chars[Math.floor(Math.random()*chars.length)]; return s; }
function roomInfo(room) { return { code: room.code, isPublic: room.isPublic, players: [...room.players.values()].map(p => ({id:p.id,name:p.name,ready:p.ready})), maxPlayers: MAX_PLAYERS }; }
function emitRoom(room) { io.to(room.code).emit('room:update', roomInfo(room)); }
function makeRoom(isPublic) { let c; do { c=code(); } while(rooms.has(c)); const room={code:c,isPublic,players:new Map(),created:Date.now()}; rooms.set(c,room); return room; }
function joinRoom(socket, room, name) {
  if(room.players.size >= MAX_PLAYERS) return socket.emit('room:error','این اتاق پر است.');
  for(const r of rooms.values()) if(r.players.has(socket.id)) leaveRoom(socket, r);
  const p={id:socket.id,name:cleanName(name),ready:false,x:0,y:0,z:0,yaw:0,hp:100};
  room.players.set(socket.id,p); socket.join(room.code); socket.data.room=room.code;
  socket.emit('room:joined',{...roomInfo(room),selfId:socket.id});
  socket.to(room.code).emit('player:joined',{id:p.id,name:p.name,state:p}); emitRoom(room);
  socket.emit('world:state',[...room.players.values()].filter(q=>q.id!==socket.id));
}
function leaveRoom(socket, room) {
  room.players.delete(socket.id); socket.leave(room.code); socket.data.room=null;
  io.to(room.code).emit('player:left',{id:socket.id}); emitRoom(room);
  if(room.players.size===0) rooms.delete(room.code);
}
app.get('/health',(_,res)=>res.json({name:'MINI FPS online server',ok:true,status:'ok',players:[...rooms.values()].reduce((n,r)=>n+r.players.size,0),rooms:rooms.size,uptime:Math.round(process.uptime())}));
// Serve the actual game at the public Render URL instead of returning only server status.
app.get('/',(_,res)=>res.sendFile(path.join(__dirname,'mini_fps_online.html')));
io.on('connection', socket => {
  socket.emit('server:hello',{name:'MINI FPS',maxPlayers:MAX_PLAYERS});
  socket.on('room:create',(data={})=>{ const room=makeRoom(false); joinRoom(socket,room,data.name); });
  socket.on('room:join',(data={})=>{ const c=String(data.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5); const room=rooms.get(c); if(!room)return socket.emit('room:error','کد اتاق پیدا نشد.'); joinRoom(socket,room,data.name); });
  socket.on('match:find',(data={})=>{
    let room=publicQueue.map(c=>rooms.get(c)).find(r=>r && r.players.size<MAX_PLAYERS);
    if(!room){room=makeRoom(true);publicQueue.push(room.code);}
    joinRoom(socket,room,data.name); socket.emit('match:found',{code:room.code});
  });
  socket.on('player:state',(state={})=>{
    const room=rooms.get(socket.data.room); if(!room)return; const p=room.players.get(socket.id); if(!p)return;
    for(const k of ['x','y','z','yaw','hp']) if(Number.isFinite(Number(state[k]))) p[k]=Math.max(k==='hp'?0:-10000,Math.min(k==='hp'?100:10000,Number(state[k])));
    io.to(room.code).volatile.emit('player:state',{id:socket.id,x:p.x,y:p.y,z:p.z,yaw:p.yaw,hp:p.hp});
  });
  socket.on('game:event',(event={})=>{const room=rooms.get(socket.data.room);if(!room)return; const type=String(event.type||'').slice(0,24); if(!['fire','hit','down','revive','reload'].includes(type))return; socket.to(room.code).emit('game:event',{id:socket.id,type,x:Number(event.x)||0,y:Number(event.y)||0,z:Number(event.z)||0,yaw:Number.isFinite(Number(event.yaw))?Number(event.yaw):0,target:String(event.target||'').slice(0,32),weapon:String(event.weapon||'rifle').slice(0,12)});});
  socket.on('room:leave',()=>{const room=rooms.get(socket.data.room);if(room)leaveRoom(socket,room);});
  socket.on('disconnect',()=>{const room=rooms.get(socket.data.room);if(room)leaveRoom(socket,room);});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`MINI FPS online server listening on ${PORT}`));
