const puppeteer = require('puppeteer');
const XLSX = require('xlsx');

(async () => {
  // Launch the browser instance
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Replace with the actual URL you want to scrape
  await page.goto('https://exhibitors.transportlogistic.de/en/exhibitors-and-directories/exhibitors-brand-names', { waitUntil: 'networkidle2' });

  // Accept cookie consent if available
  try {
    // Wait for the shadow host element to be available
    await page.waitForSelector('#usercentrics-cmp-ui', { timeout: 5000 });
  
    // Access the shadow root and query for the accept button
    const acceptButtonHandle = await page.$('#usercentrics-cmp-ui');
    const shadowRoot = await acceptButtonHandle.evaluateHandle(el => el.shadowRoot);
  
    // Wait for the accept button inside the shadow DOM to be available
    await shadowRoot.waitForSelector('.accept', { timeout: 5000 });
  
    // Click the accept button inside the shadow DOM
    await shadowRoot.$eval('.accept', button => button.click());
  
    console.log('Cookie consent accepted.');
  } catch (error) {
    console.log('Cookie consent button not found or already accepted.');
  }
    

  let scrapedData = [];

  // Wait for the navigation list to load
  await page.waitForSelector('.pagination li');

  // Get the navigation list items; note that these elements may change as you navigate,
  // so we re-query them in each iteration.
  const navElements = await page.$$('.pagination li');

  for (let i = 0; i < navElements.length-27; i++) {
    // Re-fetch the navigation list items on each iteration because the DOM might be refreshed.
    const navItems = await page.$$('.pagination li');
    const navItem = navItems[i];
    const anchorTag = await navItem.$('a');

    // Click on the navigation list item to load the category page
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      anchorTag.click()
    ]);
    console.log(`Processing navigation item ${i + 1}`);

    // Process the company listings inside the category
    let processingListings = true;
    let count = 0;

    while (processingListings) {

      const companySelector = await page.$$(".content_hits .content_company");
      let companyAnchor;
      try {
        companyAnchor = await companySelector[count].$('a');
      } catch (error) {
        companyAnchor = null;
      }
      

      // If no company anchor is found, check if "Load More" is available
      if (!companyAnchor) {
        const loadMoreButton = await page.$('.lazymore');
        if (loadMoreButton) {
          console.log('Scrolling to "Load More" button...');
    
          // Scroll the element into view before clicking
          await page.evaluate(button => {
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, loadMoreButton);
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));
          console.log('Clicking "Load More" button...');
          try {
            await loadMoreButton.click();
          } catch (error) {
            console.log("error clicking load more button");
          }
          

          // Wait for AJAX content to load
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 7000)));

          continue;
        } else {
          console.log('No more listings found.');
          processingListings = false;
          break;
        }
      }

      // Scroll the element into view
      await companyAnchor.evaluate(el => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      // Wait for scrolling to complete
      await new Promise(resolve => setTimeout(resolve, 1000));


      // Click on the company anchor and wait for navigation
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        companyAnchor.click()
      ]);
      count++;
      console.log('Scraping company details...');

      // Wait for the contact info container to load
      await page.waitForSelector('.exhibitordetails-contactinfo-list', { timeout: 5000 }).catch(() => {
        console.log('Contact info not found.');
      });

      const companyDetails = await page.evaluate(() => {
        const details = { 
            name: '', 
            phone: '', 
            fax: '', 
            email: '', 
            website: '', 
            address: '' 
        };
    
        // Extract name from .info h1
        const nameElement = document.querySelector('.info h1');
        if (nameElement) {
            details.name = nameElement.textContent.trim();
        }
    
        // Extract contact details from .exhibitordetails-contactinfo-list li
        const items = document.querySelectorAll('.exhibitordetails-contactinfo-list li');
        items.forEach(item => {
            const text = item.textContent.trim();
            if (/phone/i.test(text)) {
                details.phone = text.replace(/.*Phone:\s*/i, '').trim();
            } else if (/fax/i.test(text)) {
                details.fax = text.replace(/.*Fax:\s*/i, '').trim();
            } else if (/e-mail/i.test(text)) {
                details.email = text.replace(/.*e-mail:\s*/i, '').trim();
            } else if (/website/i.test(text)) {
                details.website = text.replace(/.*Website:\s*/i, '').trim();
            }
        });
    
        return details;
    });
    

      // Extract address separately
      const addressText = await page.$eval('.exhibitordetails-locationinfo', el => el.textContent.trim()).catch(() => '');
      companyDetails.address = addressText.replace(/.*Address\s*/i, '').trim();

      // Store the data
      scrapedData.push(companyDetails);

      // Go back to the category page
      await page.goBack();

      // Wait before continuing to the next iteration
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));

      console.log(`Finished scraping company ${companyDetails.name}`);
    }
  }

  // Once all data is collected, write it to an Excel file.
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(scrapedData);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Companies');

  // Save the file locally
  XLSX.writeFile(workbook, 'transport-logistics all company details.xlsx');
  console.log('Scraping complete. Data saved to company_data.xlsx');

  await browser.close();
})();
