import 'reflect-metadata';
import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {DataSource,getMetadataArgsStorage} from 'typeorm';
import express from 'express';
import type {Server} from 'node:http';
import request from 'supertest';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {config} from '@enterpriseglue/shared/config/index.js';
import {getDataSource} from '@enterpriseglue/shared/db/data-source.js';
import {User} from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import {RefreshToken} from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import {generateAccessToken} from '@enterpriseglue/shared/utils/jwt.js';
import {requireAuth} from '@enterpriseglue/shared/middleware/auth.js';
import {AppError} from '@enterpriseglue/shared/middleware/errorHandler.js';
import route from '../../../packages/backend-host/src/modules/auth/routes/documentation.js';

vi.mock('@enterpriseglue/shared/db/data-source.js',()=>({getDataSource:vi.fn()}));
vi.mock('@enterpriseglue/shared/services/bpmn-engine-request-context.js',()=>({updateBpmnEngineRequestContext:vi.fn()}));
const schema=`documentation_gateway_${Date.now()}`;
const accountOrigin='https://account.example.test';
const docsOrigin='https://docs.example.test';
const sessionId='22222222-2222-4222-8222-222222222222';
const originalFetch=globalThis.fetch;
const originalSchemas:Array<{table:{schema?:string};schema?:string}>=[];
let fixture:DataSource;let server:Server;let browserToken:string;
let gateway:{fetch:(request:Request,env:unknown)=>Promise<Response>};
const gatewayEnv={DOCUMENTATION_ORIGIN:docsOrigin,ACCOUNT_ORIGIN:accountOrigin,DOCUMENTATION_GATEWAY_SECRET:'owned-disposable-gateway-key-'.repeat(2),ASSETS:{fetch:vi.fn(async()=>new Response('qualified protected article'))}};
const calls:string[]=[];
beforeAll(async()=>{
  const module=process.env.DOCUMENTATION_GATEWAY_MODULE;
  if(process.env.SESSION_RACE_DISPOSABLE_POSTGRES!=='true'||!process.env.MIGRATION_TEST_POSTGRES_CONTAINER||!module) throw new Error('Owned disposable PostgreSQL and the exact documentation gateway module are required.');
  gateway=(await import(/* @vite-ignore */ pathToFileURL(module).href)).default;
  const digest=createHash('sha256').update(await readFile(module)).digest('hex');
  console.log(`Documentation gateway acceptance source SHA-256: ${digest}`);
  Object.assign(config,{tenancyMode:'pooled',tenancyCloudRequired:true,cloudAccountIdentityEnabled:true,frontendUrl:accountOrigin,documentationOrigin:docsOrigin,documentationGatewaySecret:gatewayEnv.DOCUMENTATION_GATEWAY_SECRET});
  for(const entity of [User,RefreshToken]){
    const table=getMetadataArgsStorage().tables.find(entry=>entry.target===entity)!;
    originalSchemas.push({table,schema:table.schema});table.schema=schema;
  }
  fixture=new DataSource({type:'postgres',host:process.env.MIGRATION_TEST_POSTGRES_HOST,port:Number(process.env.MIGRATION_TEST_POSTGRES_PORT),username:process.env.MIGRATION_TEST_POSTGRES_USER,password:process.env.MIGRATION_TEST_POSTGRES_PASSWORD,database:process.env.MIGRATION_TEST_POSTGRES_DATABASE,schema,entities:[User,RefreshToken],synchronize:false});
  await fixture.initialize();await fixture.query(`CREATE SCHEMA "${schema}"`);await fixture.synchronize();
  vi.mocked(getDataSource).mockResolvedValue(fixture);
  const now=Date.now();const user=fixture.getRepository(User).create({id:'documentation-reader',email:'reader@example.test',isActive:true,isEmailVerified:true,authSessionVersion:0,createdAt:now,updatedAt:now});
  await fixture.getRepository(User).save(user);
  await fixture.getRepository(RefreshToken).insert({id:sessionId,userId:user.id,tenantId:null,tokenHash:'owned-test-session',createdAt:now,expiresAt:now+600_000,revokedAt:null,deviceInfo:JSON.stringify({sessionClass:'cloud_account'})});
  browserToken=generateAccessToken(user,{sessionId,authenticationMethod:'oidc',sessionClass:'cloud_account'});
  const app=express();app.use(express.json());app.use(route);
  app.get('/application-api',requireAuth,(_req,res)=>res.json({unexpected:true}));
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error instanceof AppError?error.statusCode:500).json({error:error instanceof Error?error.message:'error'}));
  await new Promise<void>(done=>{server=app.listen(0,'127.0.0.1',()=>done());});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture listener unavailable');
  globalThis.fetch=async(input,options)=>{
    const url=new URL(String(input));if(url.origin!==accountOrigin)throw new Error('Unexpected outbound account origin');
    calls.push(url.pathname);
    return originalFetch(`http://127.0.0.1:${address.port}${url.pathname}`,options);
  };
},60_000);
afterAll(async()=>{
  globalThis.fetch=originalFetch;
  if(server){server.closeAllConnections();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));}
  if(fixture?.isInitialized){await fixture.query(`DROP SCHEMA "${schema}" CASCADE`);await fixture.destroy();}
  for(const entry of originalSchemas)entry.table.schema=entry.schema;
});
it('completes real account HTTP grant/exchange/read with PostgreSQL, then handles sign-out and source-session revocation',async()=>{
  const documents=await gateway.fetch(new Request(`${docsOrigin}/docs/0.29/start?language=python`),gatewayEnv);
  expect(documents.status).toBe(302);expect(gatewayEnv.ASSETS.fetch).not.toHaveBeenCalled();
  const pending=documents.headers.get('set-cookie')!.split(';')[0]!;
  const account=new URL(documents.headers.get('location')!);
  expect(account.pathname).toBe('/documentation/access');
  const created=await request(server).post('/api/auth/documentation/grant').set('Origin',accountOrigin).set('Authorization',`Bearer ${browserToken}`).send({state:account.searchParams.get('state'),challenge:account.searchParams.get('challenge')});
  expect(created.status,JSON.stringify(created.body)).toBe(200);
  const completed=await gateway.fetch(new Request(created.body.callbackUrl,{headers:{cookie:pending}}),gatewayEnv);
  expect(completed.status).toBe(303);expect(completed.headers.get('location')).toBe(`${docsOrigin}/docs/0.29/start?language=python`);
  const cookie=completed.headers.get('set-cookie')!.split(';')[0]!;
  const article=await gateway.fetch(new Request(`${docsOrigin}/docs/0.29/start`,{headers:{cookie}}),gatewayEnv);
  expect(article.status).toBe(200);expect(await article.text()).toBe('qualified protected article');expect(article.headers.get('cache-control')).toBe('private, no-store');
  const proof=cookie.slice(cookie.indexOf('=')+1);
  expect((await request(server).get('/application-api').set('Authorization',`Bearer ${proof}`)).status).toBe(401);
  expect((await gateway.fetch(new Request(created.body.callbackUrl,{headers:{cookie:pending}}),gatewayEnv)).status).toBe(401);
  const signedOut=await gateway.fetch(new Request(`${docsOrigin}/auth/logout`,{method:'POST',headers:{origin:docsOrigin,cookie}}),gatewayEnv);
  expect(signedOut.status).toBe(303);expect(signedOut.headers.get('set-cookie')).toContain('Max-Age=0');
  expect((await gateway.fetch(new Request(`${docsOrigin}/auth/signed-out`),gatewayEnv)).status).toBe(200);
  expect((await gateway.fetch(new Request(`${docsOrigin}/docs/0.29/start`,{headers:{cookie}}),gatewayEnv)).status).toBe(302);
  expect((await fixture.getRepository(RefreshToken).findOneByOrFail({id:sessionId})).revokedAt).toBeNull();
  // A new, active documentation token is independently denied by parent-session revocation.
  const restarted=await gateway.fetch(new Request(`${docsOrigin}/docs/0.29/start`),gatewayEnv);
  const secondAccount=new URL(restarted.headers.get('location')!);
  const secondGrant=await request(server).post('/api/auth/documentation/grant').set('Origin',accountOrigin).set('Authorization',`Bearer ${browserToken}`).send({state:secondAccount.searchParams.get('state'),challenge:secondAccount.searchParams.get('challenge')});
  expect(secondGrant.status).toBe(200);
  const secondCallback=await gateway.fetch(new Request(secondGrant.body.callbackUrl,{headers:{cookie:restarted.headers.get('set-cookie')!.split(';')[0]!}}),gatewayEnv);
  expect(secondCallback.status).toBe(303);
  const secondCookie=secondCallback.headers.get('set-cookie')!.split(';')[0]!;
  expect((await gateway.fetch(new Request(`${docsOrigin}/documentation-search.json`,{headers:{cookie:secondCookie}}),gatewayEnv)).status).toBe(200);
  await fixture.getRepository(RefreshToken).update({id:sessionId},{revokedAt:Date.now()});
  const revoked=await gateway.fetch(new Request(`${docsOrigin}/documentation-search.json`,{headers:{cookie:secondCookie}}),gatewayEnv);
  expect(revoked.status).toBe(302);expect(gatewayEnv.ASSETS.fetch).toHaveBeenCalledTimes(2);
  expect(await fixture.getRepository(User).count()).toBe(1);
  expect(await fixture.getRepository(RefreshToken).count()).toBe(1);
  expect((await fixture.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename',[schema])).map((row:{tablename:string})=>row.tablename)).toEqual(['refresh_tokens','users']);
  expect(calls.every(path=>['/api/auth/documentation/exchange','/api/auth/documentation/session','/api/auth/documentation/logout'].includes(path))).toBe(true);
});
