/*
* THIS IS EXPERIMENTAL - THE HC FORM DOES NOT GET COPIED UNLESS THE USER HAS
* EDIT PERMISSIONS ON THE FORM.  I AM TRYING TO FIND ALTERNATIVES TO GETTING 
* THE FORM COPIED TO THE NEW SPREADSHEET.  THIS APPROACH IS TO SERIALIZE THE 
* FORM AND THEN RECONSTRUCT IT IN THE NEW SPREADSHEET.  THIS IS A WORK IN PROGRESS
* AND IS NOT YET FUNCTIONAL.
*
* If you have any solution to this problem, please let me know.
*/

function exportForm() {
    // Open the form by URL or ID
    var formUrl = SpreadsheetApp.getActiveSpreadsheet().getFormUrl();
    var form = FormApp.openByUrl(formUrl);
    // var form = FormApp.openById('FORM_ID'); // Uncomment and replace with your Form ID if needed

    var items = form.getItems();
    var formData = [];

    items.forEach(function(item) {
        var itemType = item.getType();
        var title = item.getTitle();
        var description = item.getHelpText();
        var itemDetails = {
            type: itemType,
            title: title,
            description: description,
        };

        // Handle different item types
        if (itemType == FormApp.ItemType.MULTIPLE_CHOICE) {
            var multipleChoiceItem = item.asMultipleChoiceItem();
            itemDetails.options = multipleChoiceItem.getChoiceValues();
        } else if (itemType == FormApp.ItemType.CHECKBOX) {
            var checkboxItem = item.asCheckboxItem();
            itemDetails.options = checkboxItem.getChoiceValues();
        } else if (itemType == FormApp.ItemType.TEXT) {
            var textItem = item.asTextItem();
            itemDetails.textValidation = textItem.getValidation() ? textItem.getValidation().getHelpText() : null;
        } else if (itemType == FormApp.ItemType.PARAGRAPH_TEXT) {
            var paragraphItem = item.asParagraphTextItem();
            itemDetails.textValidation = paragraphItem.getValidation() ? paragraphItem.getValidation().getHelpText() : null;
        } else if (itemType == FormApp.ItemType.DROP_DOWN) {
            var dropDownItem = item.asListItem();
            itemDetails.options = dropDownItem.getChoiceValues();
        } else if (itemType == FormApp.ItemType.SCALE) {
            var scaleItem = item.asScaleItem();
            itemDetails.minLabel = scaleItem.getLeftLabel();
            itemDetails.maxLabel = scaleItem.getRightLabel();
            itemDetails.lowerBound = scaleItem.getLowerBound();
            itemDetails.upperBound = scaleItem.getUpperBound();
        } else if (itemType == FormApp.ItemType.DATE) {
            var dateItem = item.asDateItem();
            itemDetails.dateFormat = dateItem.getDateFormat();
        } else if (itemType == FormApp.ItemType.TIME) {
            var timeItem = item.asTimeItem();
            itemDetails.timeFormat = timeItem.getTimeFormat();
        } else if (itemType == FormApp.ItemType.CHECKBOX_GRID) {
            var checkboxGridItem = item.asCheckboxGridItem();
            itemDetails.rows = checkboxGridItem.getRows();
            itemDetails.columns = checkboxGridItem.getColumns();
        } else if (itemType == FormApp.ItemType.GRID) {
            var gridItem = item.asGridItem();
            itemDetails.rows = gridItem.getRows();
            itemDetails.columns = gridItem.getColumns();
        } else if (itemType == FormApp.ItemType.FILE_UPLOAD) {
            var fileUploadItem = item.asFileUploadItem();
            itemDetails.allowedFileTypes = fileUploadItem.getAcceptedFileTypes();
        } else if (itemType == FormApp.ItemType.SECTION_HEADER) {
            // Section headers don't have choices, just a title
            itemDetails.sectionHeader = title;
        } else if (itemType == FormApp.ItemType.PAGE_BREAK) {
            // Page breaks can be handled similarly as section headers
            itemDetails.pageBreak = true;
        } else if (itemType == FormApp.ItemType.IMAGE) {
            var imageItem = item.asImageItem();
            itemDetails.imageBlob = imageItem.getBlob();
            itemDetails.imageAlignment = imageItem.getAlignment();
            itemDetails.imageWidth = imageItem.getWidth();
            itemDetails.imageHeight = imageItem.getHeight();
        } else if (itemType == FormApp.ItemType.VIDEO) {
            var videoItem = item.asVideoItem();
            itemDetails.videoUrl = videoItem.getVideoUrl();
            itemDetails.videoAlignment = videoItem.getAlignment();
            itemDetails.videoWidth = videoItem.getWidth();
            itemDetails.videoHeight = videoItem.getHeight();
        }

        formData.push(itemDetails);
    });

    // Convert form data to JSON string
    var formDataJson = JSON.stringify(formData);

    // Create a file in Google Drive to save the form data
    var fileName = form.getTitle() + ' Exported Data.json';
    var file = DriveApp.createFile(fileName, formDataJson, MimeType.JSON);

    Logger.log('Form data exported to file: ' + file.getUrl());
}


function importForm() {
    // Prompt the user for the file ID
    var fileId = Browser.inputBox('Enter the ID of the exported form data file:');
    if (!fileId) {
        Logger.log('Operation canceled. No file ID provided.');
        return;
    }

    try {
        // Open the file and read its contents
        var file = DriveApp.getFileById(fileId);
        var fileContent = file.getBlob().getDataAsString();
        var formData = JSON.parse(fileContent);

        // Create a new form
        var newForm = FormApp.create('Imported Form');

        // Add items to the new form based on the exported data
        formData.forEach(function(itemDetails) {
            var itemType = itemDetails.type;
            var title = itemDetails.title;
            var description = itemDetails.description;

            if (itemType == FormApp.ItemType.MULTIPLE_CHOICE) {
                var item = newForm.addMultipleChoiceItem();
                item.setTitle(title)
                    .setHelpText(description)
                    .setChoiceValues(itemDetails.options);
            } else if (itemType == FormApp.ItemType.CHECKBOX) {
                var item = newForm.addCheckboxItem();
                item.setTitle(title)
                    .setHelpText(description)
                    .setChoiceValues(itemDetails.options);
            } else if (itemType == FormApp.ItemType.TEXT) {
                var item = newForm.addTextItem();
                item.setTitle(title)
                    .setHelpText(description);
                if (itemDetails.textValidation) {
                    var validation = FormApp.createTextValidation()
                        .requireTextMatchesPattern(itemDetails.textValidation)
                        .build();
                    item.setValidation(validation);
                }
            } else if (itemType == FormApp.ItemType.PARAGRAPH_TEXT) {
                var item = newForm.addParagraphTextItem();
                item.setTitle(title)
                    .setHelpText(description);
                if (itemDetails.textValidation) {
                    var validation = FormApp.createParagraphTextValidation()
                        .requireTextMatchesPattern(itemDetails.textValidation)
                        .build();
                    item.setValidation(validation);
                }
            } else if (itemType == FormApp.ItemType.DROP_DOWN) {
                var item = newForm.addListItem();
                item.setTitle(title)
                    .setHelpText(description)
                    .setChoiceValues(itemDetails.options);
            } else if (itemType == FormApp.ItemType.SCALE) {
                var item = newForm.addScaleItem();
                item.setTitle(title)
                    .setHelpText(description)
                    .setBounds(itemDetails.lowerBound, itemDetails.upperBound)
                    .setLabels(itemDetails.minLabel, itemDetails.maxLabel);
            } else if (itemType == FormApp.ItemType.DATE) {
                var item = newForm.addDateItem();
                item.setTitle(title)
                    .setHelpText(description);
            } else if (itemType == FormApp.ItemType.TIME) {
                var item = newForm.addTimeItem();
                item.setTitle(title)
                    .setHelpText(description);
            } else if (itemType == FormApp.ItemType.CHECKBOX_GRID) {
                var item = newForm.addCheckboxGridItem();
                item.setTitle(title)
                    .setHelpText(description)
                    .setRows(itemDetails.rows)
                    .setColumns(itemDetails.columns);
            } else if (itemType == FormApp.ItemType.GRID) {
                var item = newForm.addGridItem();
                item.setTitle(title)
                    .setHelpText(description)
                    .setRows(itemDetails.rows)
                    .setColumns(itemDetails.columns);
            } else if (itemType == FormApp.ItemType.FILE_UPLOAD) {
                var item = newForm.addFileUploadItem();
                item.setTitle(title)
                    .setHelpText(description)
                    .setAcceptableFileTypes(itemDetails.allowedFileTypes);
            } else if (itemType == FormApp.ItemType.SECTION_HEADER) {
                var item = newForm.addSectionHeaderItem();
                item.setTitle(title)
                    .setHelpText(description);
            } else if (itemType == FormApp.ItemType.PAGE_BREAK) {
                var item = newForm.addPageBreakItem();
                item.setTitle(title)
                    .setHelpText(description);
            } else if (itemType == FormApp.ItemType.IMAGE) {
                var item = newForm.addImageItem();
                item.setTitle(title)
                    .setHelpText(description)
                    .setImage(UrlFetchApp.fetch(itemDetails.imageUrl).getBlob())
                    .setAlignment(itemDetails.imageAlignment)
                    .setWidth(itemDetails.imageWidth)
                    .setHeight(itemDetails.imageHeight);
            } else if (itemType == FormApp.ItemType.VIDEO) {
                var item = newForm.addVideoItem();
                item.setTitle(title)
                    .setHelpText(description)
                    .setVideoUrl(itemDetails.videoUrl)
                    .setAlignment(itemDetails.videoAlignment)
                    .setWidth(itemDetails.videoWidth)
                    .setHeight(itemDetails.videoHeight);
            }
        });

        Logger.log('New form created: ' + newForm.getEditUrl());
    } catch (e) {
        Logger.log('Error importing form: ' + e.message);
    }
}