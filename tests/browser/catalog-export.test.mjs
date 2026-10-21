import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('../../', import.meta.url)),origin='https://kollection.test';
const cat=type=>({id:'mdblist.123',type,name:'Trending',source:'mdblist',enabled:true,enableRatingPosters:false});
const pack=[{id:'discover',title:'Discover',folders:[{id:'trending',title:'Trending',sources:[{addonId:'aio-metadata',catalogId:'mdblist.123',type:'movie'}]}]}];
const fixture={aioRoutingVersion:1,collectionPack:pack,selectedCollectionGroupIds:['discover'],collectionSelectionInitialized:true,bingecatSkipped:true,profileId:2,profileName:'Test Profile',aiNeededCatalogs:[cat('movie'),cat('series')],aiChunks:[{catalogs:[cat('movie')]},{catalogs:[cat('series')]}],aiInstalls:[],backup:{},previewCollections:pack,finalCollections:pack,installCompleted:true};
const saved={id:'saved-one',name:'My Kollection with a longer name',draftStep:7,nuvioProfileId:2,nuvioProfileName:'Test profile',config:{selectedCollectionGroupIds:['discover'],aiometadataExports:[{config:{catalogs:[cat('movie')] }},{config:{catalogs:[cat('series')]}}]}};
const keepScripts=['/set-up-collection/config.js','/set-up-collection/aio-catalog-export.js','/set-up-collection/set-up-collection.js','/account/saved-collections.js'];
test('catalog downloads work in Review, Done, and saved setups on mobile and desktop', { timeout: 120000 }, async () => {
const browser=await chromium.launch({headless:true});try{
 for(const width of [390,900,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390,acceptDownloads:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({fixture})=>{sessionStorage.setItem('kollection-setup-wizard:v1',JSON.stringify({...fixture,savedAt:Date.now()}));window.KollectionNuvioAuth={getSession:async()=>({authenticated:true,user:{id:'fixture'}})};},{fixture});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/account/collections')return route.fulfill({json:{collections:[saved]}});
  if(url.pathname==='/api/account/collections/saved-one')return route.fulfill({json:{collection:saved}});
  if(url.origin!==origin)return route.fulfill({json:{}});
  let relative=url.pathname.slice(1);if(relative==='set-up-collection')relative='set-up-collection.html';if(relative==='account')relative='account.html';
  try{let body=await fs.readFile(path.join(root,relative));if(relative.endsWith('.html'))body=body.toString().replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(m,src)=>keepScripts.includes(src.split('?')[0])?m:'');
  await route.fulfill({body,contentType:relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.html')?'text/html':'application/octet-stream'});
  }catch{await route.fulfill({status:404,body:''});}
 });
 for(const [step,button] of [['review','#aioCatalogExportBtn'],['complete','#doneAioCatalogExportBtn'],['account','button:has-text("Export catalogs only")']]){
  await page.goto(step==='account'?origin+'/account':origin+'/set-up-collection?step='+step);
  if(step==='account')await page.locator('#accountSignedIn').evaluate(el=>el.hidden=false).catch(()=>{});
  const target=page.locator(button);await target.waitFor({state:'attached'});
  if(step==='account')await page.evaluate(()=>{document.querySelectorAll('[hidden]').forEach(el=>{if(el.querySelector('#accountSavedCollections'))el.hidden=false;});});
  await target.scrollIntoViewIfNeeded();
  const downloadPromise=page.waitForEvent('download');await target.click();const download=await downloadPromise;const payload=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(payload.version,1);assert.equal(payload.catalogs.length,2);assert.equal(Object.hasOwn(payload.catalogs[0],'enableRatingPosters'),false);
  assert.match(download.suggestedFilename(),/^AIOMetadata-Catalogs-/);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false,step+' horizontal overflow '+width);
  console.log(width,step,'download passed');
 }
 assert.deepEqual(errors,[]);await context.close();
 }
}finally{await browser.close();}
});
