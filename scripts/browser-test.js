const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {server}=require('./test-server')(process.argv[2]);
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 try{
  for(const viewport of [{width:1280,height:800},{width:390,height:844}]){
   const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:'+server.address().port+'/');
   await page.locator('#filter-options input').first().waitFor({state:'attached'});
   await page.locator('#from').fill('Tom Morello');
   await page.locator('#from-options button').first().click({timeout:20000});
   await page.locator('#detail h1').getByText('Tom Morello',{exact:true}).waitFor({timeout:20000});
   assert.equal(await page.locator('#dimension button[aria-pressed=true]').textContent(),'3D');
   assert.ok(await page.locator('#network canvas').count());
   await page.locator('#detail').getByRole('button',{name:'Evidence',exact:true}).click();
   await page.locator('#records .record').first().waitFor({timeout:20000});
   await page.locator('#dimension [data-dimension="2D"]').click();
   assert.equal(await page.locator('#dimension button[aria-pressed=true]').textContent(),'2D');
   await page.locator('#dimension [data-dimension="3D"]').click();
   assert.equal(await page.locator('#dimension button[aria-pressed=true]').textContent(),'3D');
   assert.ok(await page.locator('#network canvas').count());
   await page.locator('#layout-button').click();
   await page.locator('#layout-mode').selectOption('force');
   await page.locator('#labels').uncheck();
   await page.locator('#labels').check();
   await page.locator('#layout-mode').selectOption('cluster');
   await page.locator('#max-connections').fill('3');
   await page.locator('#generate-map').click();
   await page.locator('#status').getByText(/eligible direct connections/).waitFor({timeout:20000});
   assert.ok(Number((await page.locator('#map-count').textContent()).match(/(\d+) links/)[1])<=3);
   await page.locator('#layout-button').click();
   await page.locator('#connect-map').click();
   await page.locator('#status').getByText(/additional relationships drawn/).waitFor({timeout:20000});
   await page.locator('#layout-button').click();
   assert.ok(await page.locator('#detail a[href^="https://open.spotify.com/search/"]').count());
   await page.locator('#filters summary').click();
   if(await page.locator('#filter-options input').count()===5){
    for(const input of await page.locator('#filter-options input').all())await input.uncheck();
    await page.locator('#map-count').getByText('1 artists · 0 links',{exact:true}).waitFor({timeout:20000});
   }
   assert.deepEqual(errors,[]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   console.log('Browser passed',viewport.width,'px');
   await page.close();
  }
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
