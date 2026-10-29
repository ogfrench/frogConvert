import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://deploy-preview-101--frogconvert.netlify.app";
const OUTPUT = "visual-qa-shots";
fs.mkdirSync(OUTPUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
async function grab(mode, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  try {
    const response = await page.goto(BASE + "/convert", {waitUntil:"networkidle2", timeout:100000});
    console.log(mode, "HTTP", response?.status(), "URL", page.url());
    if (!response || ![200,304].includes(response.status())) throw Error("Preview not accessible: " + response?.status());
    await page.waitForSelector("#file-input", { timeout:100000 });
    await page.click("#theme-toggle");
    await new Promise(resolve => setTimeout(resolve, 300));
    await page.screenshot({path: path.join(OUTPUT, mode+"-converter.png"), fullPage:true});
    await page.evaluate(() => document.querySelector('#format-mode-menu [data-value="all"]')?.click());
    await page.waitForFunction(() => (window.traversionGraph?.nodeCount ?? 0)>0, {timeout:100000});
    const input=await page.$("#file-input");
    await input.uploadFile("test/resources/styled-page.html");
    await page.waitForSelector("#format-selector",{visible:true,timeout:40000});
    await page.click("#format-selector");
    await page.waitForSelector("#format-modal.open", {timeout:40000});
    const picked=await page.evaluate(()=>{
      const items=[...document.querySelectorAll(".format-option")];
      const opt=items.find(el=>/^PDF\b/i.test(el.textContent?.trim()??"")&&!el.classList.contains("unavailable"));
      if(!opt) return false;
      opt.click();return true;
    });
    if(!picked) throw Error("PDF destination not available");
    await page.waitForFunction(()=>document.querySelector("#convert-button")?.getAttribute("aria-disabled")!=="true",{timeout:30000});
    await page.click("#convert-button");
    await page.waitForFunction(()=>[...document.querySelectorAll("#popup button")].some(el=>el.textContent==="Open Save as PDF"),{timeout:100000});
    const modalText=await page.$eval("#popup",el=>el.textContent);
    if(!modalText.includes("Create image-based PDF instead"))throw Error("Native export popup not reached");
    await page.screenshot({path:path.join(OUTPUT,mode+"-native-html-pdf.png"),fullPage:true});
    await page.evaluate(() => {
      const scroll=document.querySelector("#popup .popup-scroll");
      if(scroll) scroll.scrollTop=scroll.scrollHeight;
    });
    await page.screenshot({path:path.join(OUTPUT,mode+"-native-html-pdf-actions.png"),fullPage:true});
    console.log(mode, "Native print sheet captured; page errors", errors.slice(-4));
  } catch(e) {
    console.error(mode, "CAPTURE ERROR:",e);
    await page.screenshot({path:path.join(OUTPUT,mode+"-error.png"),fullPage:true}).catch(()=>{});
    throw e;
  } finally {await page.close();}
}
try {
  await grab("desktop",{width:1440,height:1000,deviceScaleFactor:1});
  await grab("mobile",{width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
} finally {await browser.close();}
