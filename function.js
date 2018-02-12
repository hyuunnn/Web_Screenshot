// https://github.com/mrcoles/full-page-screen-capture-chrome-extension

function initiateCapture(tab, callback) {
    chrome.tabs.sendMessage(tab.id, {msg: 'scrollPage'}, function() {
        // We're done taking snapshots of all parts of the window. Display
        // the resulting full screenshot images in a new browser tab.
        callback();
    });
}

function capture(data, screenshots, sendResponse) {
    chrome.tabs.captureVisibleTab(
        null, {format: 'jpeg', quality: 100}, function(dataURI) {
            if (dataURI) {
                // downloadURI(dataURI, "aa.jpg")
                // alert(dataURI);
                var image = new Image();
                image.onload = function() {
                    data.image = {width: image.width, height: image.height};

                    // given device mode emulation or zooming, we may end up with
                    // a different sized image than expected, so let's adjust to
                    // match it!
                    if (data.windowWidth !== image.width) {
                        var scale = image.width / data.windowWidth;
                        data.x *= scale;
                        data.y *= scale;
                        data.totalWidth *= scale;
                        data.totalHeight *= scale;
                    }

                    // lazy initialization of screenshot canvases (since we need to wait
                    // for actual image size)
                    if (!screenshots.length) {
                        Array.prototype.push.apply(
                            screenshots,
                            _initScreenshots(data.totalWidth, data.totalHeight)
                        );
                    }

                    // draw it on matching screenshot canvases
                    _filterScreenshots(
                        data.x, data.y, image.width, image.height, screenshots
                    ).forEach(function(screenshot) {
                        screenshot.ctx.drawImage(
                            image,
                            data.x - screenshot.left,
                            data.y - screenshot.top
                        );
                    });
                    
                    // send back log data for debugging (but keep it truthy to
                    // indicate success)
                    sendResponse(JSON.stringify(data, null, 4) || true);
                };
                image.src = dataURI;
            }
        });
    
}

function _initScreenshots(totalWidth, totalHeight) {
    // Create and return an array of screenshot objects based
    // on the `totalWidth` and `totalHeight` of the final image.
    // We have to account for multiple canvases if too large,
    // because Chrome won't generate an image otherwise.
    //
    var MAX_PRIMARY_DIMENSION = 15000 * 2,
        MAX_SECONDARY_DIMENSION = 4000 * 2,
        MAX_AREA = MAX_PRIMARY_DIMENSION * MAX_SECONDARY_DIMENSION;

    var badSize = (totalHeight > MAX_PRIMARY_DIMENSION ||
                   totalWidth > MAX_PRIMARY_DIMENSION ||
                   totalHeight * totalWidth > MAX_AREA),
        biggerWidth = totalWidth > totalHeight,
        maxWidth = (!badSize ? totalWidth :
                    (biggerWidth ? MAX_PRIMARY_DIMENSION : MAX_SECONDARY_DIMENSION)),
        maxHeight = (!badSize ? totalHeight :
                     (biggerWidth ? MAX_SECONDARY_DIMENSION : MAX_PRIMARY_DIMENSION)),
        numCols = Math.ceil(totalWidth / maxWidth),
        numRows = Math.ceil(totalHeight / maxHeight),
        row, col, canvas, left, top;

    var canvasIndex = 0;
    var result = [];

    for (row = 0; row < numRows; row++) {
        for (col = 0; col < numCols; col++) {
            canvas = document.createElement('canvas');
            canvas.width = (col == numCols - 1 ? totalWidth % maxWidth || maxWidth :
                            maxWidth);
            canvas.height = (row == numRows - 1 ? totalHeight % maxHeight || maxHeight :
                             maxHeight);

            left = col * maxWidth;
            top = row * maxHeight;

            result.push({
                canvas: canvas,
                ctx: canvas.getContext('2d'),
                index: canvasIndex,
                left: left,
                right: left + canvas.width,
                top: top,
                bottom: top + canvas.height
            });

            canvasIndex++;
        }
    }
    return result;
}
function _filterScreenshots(imgLeft, imgTop, imgWidth, imgHeight, screenshots) {
    // Filter down the screenshots to ones that match the location
    // of the given image.
    //
    var imgRight = imgLeft + imgWidth,
        imgBottom = imgTop + imgHeight;
    return screenshots.filter(function(screenshot) {
        return (imgLeft < screenshot.right &&
                imgRight > screenshot.left &&
                imgTop < screenshot.bottom &&
                imgBottom > screenshot.top);
    });
}

//function downloadURI(blob, fname) {
//	var blob = new Blob([blob]);
//	var link = document.createElement('a');
//	link.href = window.URL.createObjectURL(blob);
//	var fileName = fname;
//	link.download = fileName;
//	link.click();
//}

function downloadBlob(blob, name) {
    var blob = new Blob([blob]);
    var link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = name;
    link.click();
    delete link;
}
    

function getBlobs(screenshots) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        var url = tabs[0].url.split("//")[1].split("/")[0];
        return screenshots.map(function(screenshot) {
            var dataURI = screenshot.canvas.toDataURL('image/jpeg',1.0);
            var now = new Date();
            var Timestamp_result = now.getFullYear() + ":" + (now.getMonth()+1) + ":" + now.getDate() + " " +  now.getHours() + ":" + now.getMinutes() + ":" + now.getSeconds() + "." + now.getMilliseconds();
            var exifIfd = {};
            var exifObj = piexif.load(dataURI);
            exifIfd[piexif.ExifIFD.DateTimeOriginal] = Timestamp_result;
            var exifObj = {"Exif":exifIfd};
            var exifStr = piexif.dump(exifObj);
            var inserted = piexif.insert(exifStr, dataURI);
            // convert base64 to raw binary data held in a string
            // doesn't handle URLEncoded DataURIs
            var byteString = atob(inserted.split(',')[1]);
            // separate out the mime component
            var mimeString = inserted.split(',')[0].split(':')[1].split(';')[0];

            // write the bytes of the string to an ArrayBuffer
            var ab = new ArrayBuffer(byteString.length);
            var ia = new Uint8Array(ab);
            for (var i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }

            // create a blob for writing to a file
            var blob = new Blob([ab], {type: mimeString});
            //downloadURI(blob,"aaaa");
            downloadBlob(blob, "full_"+url+".jpg");
        });
    });
}


function captureToBlobs(tab) {
    var loaded = false,
        screenshots = [],
        timeout = 3000,
        timedOut = false;

    // TODO will this stack up if run multiple times? (I think it will get cleared?)
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.msg === 'capture') {
            capture(request, screenshots, sendResponse);
            // https://developer.chrome.com/extensions/messaging#simple
            //
            // If you want to asynchronously use sendResponse, add return true;
            // to the onMessage event handler.
            //
            return true;
        } else {
            console.error('Unknown message received from content script: ' + request.msg);
            return false;
        }
    });
    chrome.tabs.executeScript(tab.id, {file: 'page.js'}, function() {
        if (timedOut) {
            console.error('Timed out too early while waiting for ' +
                          'chrome.tabs.executeScript. Try increasing the timeout.');
        } else {
            loaded = true;

            initiateCapture(tab, function() {
                getBlobs(screenshots);
            });
        }
    });

    window.setTimeout(function() {
        if (!loaded) {
            timedOut = true;
        }
    }, timeout);
}