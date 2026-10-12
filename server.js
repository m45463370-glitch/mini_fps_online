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
function roomInfo(room) { return { code: room.code, name: room.name, isPublic: room.isPublic, duration: room.duration, maxPlayers: room.maxPlayers, isHost: room.hostId===null, started: !!room.started, players: [...room.players.values()].map(p => ({id:p.id,name:p.name,ready:p.ready,team:p.team})), maxPlayers: room.maxPlayers }; }
function publicRooms() { return [...rooms.values()].filter(r=>r.isPublic).map(r=>({code:r.code,name:r.name,players:r.players.size,maxPlayers:r.maxPlayers,duration:r.duration})); }
function emitRoom(room) { io.to(room.code).emit('room:update', roomInfo(room)); }
function roundInfo(room) { return {code:room.code, round:room.round, red:room.red, blue:room.blue, endsAt:room.endsAt, intermission:room.intermission||0, winner:room.winner||null}; }
function spawnForTeam(team) { return team==='RED' ? {x:0,z:-38,y:1.65,yaw:0} : {x:0,z:38,y:1.65,yaw:Math.PI}; }
function spawnAllPlayers(room) { for (const p of room.players.values()) { const pos=spawnForTeam(p.team); p.x=pos.x;p.y=pos.y;p.z=pos.z;p.yaw=pos.yaw;p.pitch=0;p.hp=100;io.to(room.code).emit('player:respawn',{id:p.id,hp:100,...pos,team:p.team}); } }
function startRound(room) { room.roundTimer && clearTimeout(room.roundTimer); room.intermission=0; room.winner=null; room.red=0; room.blue=0; room.endsAt=Date.now()+room.duration*60*1000; if(room.started)spawnAllPlayers(room); io.to(room.code).emit('round:update',roundInfo(room)); room.roundTimer=setTimeout(()=>endRound(room),room.duration*60*1000); }
function endRound(room, forcedWinner=null) { if(!rooms.has(room.code)||room.intermission) return; room.roundTimer && clearTimeout(room.roundTimer); room.winner=forcedWinner || (room.red===room.blue?'DRAW':room.red>room.blue?'RED':'BLUE'); room.intermission=5; io.to(room.code).emit('round:update',roundInfo(room)); room.roundTimer=setTimeout(()=>{if(!rooms.has(room.code))return;room.round++;startRound(room);},5000); }
function makeRoom(isPublic, opts={}) { let c; do { c=code(); } while(rooms.has(c)); const room={code:c,isPublic,password:String(opts.password||''),hostId:null,started:false,name:cleanName(opts.name|| (isPublic?'Public server':'Private room')),duration:Math.max(2,Math.min(20,Number(opts.duration)||5)),maxPlayers:Math.max(2,Math.min(MAX_PLAYERS,Number(opts.maxPlayers)||MAX_PLAYERS)),players:new Map(),created:Date.now(),red:0,blue:0,round:1,roundTimer:null,endsAt:0,intermission:0,winner:null}; rooms.set(c,room); return room; }
function joinRoom(socket, room, name) {
  if(room.players.size >= room.maxPlayers) return socket.emit('room:error','این اتاق پر است.');
  for(const r of rooms.values()) if(r.players.has(socket.id)) leaveRoom(socket, r);
  const requestedTeam=String(socket.data.requestedTeam||'').toLowerCase(); const red=[...room.players.values()].filter(p=>p.team==='RED').length, blue=[...room.players.values()].filter(p=>p.team==='BLUE').length; const team=(requestedTeam==='red'||requestedTeam==='blue')?requestedTeam.toUpperCase():(red<=blue?'RED':'BLUE'); const spawn=spawnForTeam(team); const p={id:socket.id,name:cleanName(name),ready:false,team,...spawn,pitch:0,hp:100}; socket.data.requestedTeam=null;
  room.players.set(socket.id,p); socket.join(room.code); socket.data.room=room.code; if(!room.endsAt) startRound(room);
  if(room.hostId===null)room.hostId=socket.id; socket.emit('room:joined',{...roomInfo(room),isHost:room.hostId===socket.id,team:p.team,selfId:socket.id});
  socket.to(room.code).emit('player:joined',{id:p.id,name:p.name,state:p}); emitRoom(room);
  socket.emit('world:state',[...room.players.values()].filter(q=>q.id!==socket.id)); socket.emit('round:update',roundInfo(room));
}
function leaveRoom(socket, room) {
  room.players.delete(socket.id); if(room.hostId===socket.id)room.hostId=room.players.keys().next().value||null; socket.leave(room.code); socket.data.room=null;
  io.to(room.code).emit('player:left',{id:socket.id}); emitRoom(room);
  if(room.players.size===0) { if(room.roundTimer)clearTimeout(room.roundTimer); rooms.delete(room.code); }
}
app.get('/health',(_,res)=>res.json({name:'MINI FPS online server',ok:true,status:'ok',players:[...rooms.values()].reduce((n,r)=>n+r.players.size,0),rooms:rooms.size,uptime:Math.round(process.uptime())}));
app.get('/api/rooms',(_,res)=>res.json(publicRooms()));
// Serve the actual game at the public Render URL instead of returning only server status.
app.get('/',(_,res)=>res.sendFile(path.join(__dirname,'mini_fps_online.html')));
io.on('connection', socket => {
  socket.emit('server:hello',{name:'MINI FPS',maxPlayers:MAX_PLAYERS});
  socket.on('rooms:list',()=>socket.emit('rooms:list',publicRooms()));
  socket.on('room:create',(data={})=>{ const room=makeRoom(!!data.isPublic,{name:data.roomName||data.name,duration:data.duration,maxPlayers:data.maxPlayers,password:data.password}); socket.data.requestedTeam=data.team; joinRoom(socket,room,data.name); if(room.isPublic) socket.emit('rooms:list',publicRooms()); });
  socket.on('room:join',(data={})=>{ const c=String(data.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5); const room=rooms.get(c); if(!room)return socket.emit('room:error','کد اتاق پیدا نشد.'); if(!room.isPublic && String(data.password||'')!==room.password)return socket.emit('room:error','رمز سرور اشتباه است.'); socket.data.requestedTeam=data.team; joinRoom(socket,room,data.name); });
  socket.on('match:find',(data={})=>{
    let room=publicQueue.map(c=>rooms.get(c)).find(r=>r && r.players.size<MAX_PLAYERS);
    if(!room){room=makeRoom(true,{name:'Public server'});publicQueue.push(room.code);}
    socket.data.requestedTeam=data.team; joinRoom(socket,room,data.name); socket.emit('rooms:list',publicRooms()); socket.emit('match:found',{code:room.code});
  });
  socket.on('player:state',(state={})=>{
    const room=rooms.get(socket.data.room); if(!room)return; const p=room.players.get(socket.id); if(!p)return;
    for(const k of ['x','y','z','yaw','pitch','hp']) if(Number.isFinite(Number(state[k]))) p[k]=Math.max(k==='hp'?0:-10000,Math.min(k==='hp'?100:10000,Number(state[k])));
    io.to(room.code).volatile.emit('player:state',{id:socket.id,name:p.name,team:p.team,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,hp:p.hp});
  });
  socket.on('game:event',(event={})=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started||room.intermission)return;
    const type=String(event.type||'').slice(0,24); if(!['fire','hit','down','revive','reload'].includes(type))return;
    const attacker=room.players.get(socket.id); if(!attacker)return;
    const yaw=Number.isFinite(Number(event.yaw))?Number(event.yaw):attacker.yaw;
    const ox=Number.isFinite(Number(event.x))?Number(event.x):attacker.x, oz=Number.isFinite(Number(event.z))?Number(event.z):attacker.z;
    if(type==='fire'){
      // Server-side simple hitscan duel: only real opposing players can be hit.
      let best=null,bestDist=35;
      for(const victim of room.players.values()){
        if(victim.id===attacker.id||victim.team===attacker.team)continue;
        const dx=victim.x-ox,dz=victim.z-oz,dist=Math.hypot(dx,dz); if(dist<0.25||dist>bestDist)continue;
        const targetYaw=Math.atan2(dx,dz);let diff=Math.atan2(Math.sin(targetYaw-yaw),Math.cos(targetYaw-yaw));
        if(Math.abs(diff)>.105)continue;
        const pitch=Number(event.pitch)||0; if(Math.abs((victim.y||0)-(Number(event.y)||0))>3.2+Math.abs(pitch)*2)continue;
        best=victim;bestDist=dist;
      }
      if(best){
        const dmg = 25;
        best.hp = Math.max(0, best.hp - dmg);
        const killed = best.hp <= 0;
        if(killed){if(attacker.team==='RED')room.red++;else room.blue++;}
        io.to(room.code).emit('game:hit',{attacker:attacker.id,attackerName:attacker.name,attackerTeam:attacker.team,target:best.id,victimName:best.name,victimTeam:best.team,hp:best.hp,killed,red:room.red,blue:room.blue});
        io.to(room.code).emit('round:update',roundInfo(room));
        if(killed) endRound(room,attacker.team);
      }
    }
    socket.to(room.code).emit('game:event',{id:socket.id,type,x:ox,y:Number(event.y)||0,z:oz,yaw,weapon:String(event.weapon||'rifle').slice(0,12)});
  });
  socket.on('room:team',(data={})=>{const room=rooms.get(socket.data.room);if(!room)return;const p=room.players.get(socket.id);if(!p)return;const t=String(data.team||'').toUpperCase();if(t!=='RED'&&t!=='BLUE')return;p.team=t;emitRoom(room);});
  socket.on('room:start',()=>{const room=rooms.get(socket.data.room);if(!room)return;if(room.hostId!==socket.id)return socket.emit('room:error','فقط سازندهٔ سرور می‌تواند بازی را شروع کند.');room.started=true;spawnAllPlayers(room);io.to(room.code).emit('game:started',{code:room.code});if(!room.endsAt)startRound(room);});
  socket.on('room:leave',()=>{const room=rooms.get(socket.data.room);if(room)leaveRoom(socket,room);});
  socket.on('disconnect',()=>{const room=rooms.get(socket.data.room);if(room)leaveRoom(socket,room);});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`MINI FPS online server listening on ${PORT}`));
