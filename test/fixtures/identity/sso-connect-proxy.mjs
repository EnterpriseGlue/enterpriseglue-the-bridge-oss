// Owned disposable identity rehearsal only. Never publish this fixture port.
import http from 'node:http';
import net from 'node:net';
const targetPort=Number(process.env.EG_SSO_REHEARSAL_IDP_PORT);
if(!Number.isInteger(targetPort)||targetPort<1024||targetPort>65535)throw new Error('A disposable IdP port is required');
let connects=0;
const server=http.createServer((req,res)=>{
  if(req.url!=='/stats'){res.writeHead(404).end();return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({connects}));
});
server.on('connect',(req,client,head)=>{
  if(req.url!==`localhost:${targetPort}`){client.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  connects++;
  const upstream=net.connect(targetPort,'127.0.0.1',()=>{
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);
  });
  upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());
});
server.listen(28090,'0.0.0.0');
