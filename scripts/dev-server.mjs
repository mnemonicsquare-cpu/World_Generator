import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".b64":"text/plain; charset=utf-8",".mp3":"audio/mpeg"};
http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname);
  const target=path.resolve(root,"."+pathname.replaceAll("/",path.sep));
  if(target!==root&&!target.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
  const file=fs.existsSync(target)&&fs.statSync(target).isFile()?target:path.join(root,"index.html");
  response.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream"});fs.createReadStream(file).pipe(response);
}).listen(8000,"127.0.0.1",()=>console.log("World Generator at http://127.0.0.1:8000"));
