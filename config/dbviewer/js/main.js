var SQL_FROM_REGEX = /FROM\s+([^\s;]+)/mi;
var SQL_LIMIT_REGEX = /LIMIT\s+(\d+)(?:\s*,\s*(\d+))?/mi;
var SQL_SELECT_REGEX = /SELECT\s+[^;]+\s+FROM\s+/mi;

var db = null;
var rowCounts = [];
var editor = ace.edit("sql-editor");
var bottomBarDefaultPos = null, bottomBarDisplayStyle = null;
var errorBox = $("#error");
var lastCachedQueryCount = {};

var selectFormatter = function (item) {
	var index = item.text.indexOf("(");
	if (index > -1) return item.text.substring(0, index) + '<span style="color:#ccc">' + item.text.substring(index - 1) + "</span>";
	else return item.text;
};

var windowResize = function () {
	positionFooter();
	var container = $("#main-container");
	var cleft = container.offset().left + container.outerWidth();
	$("#bottom-bar").css("left", cleft);
};

var positionFooter = function () {
	var footer = $("#bottom-bar");
	var pager = footer.find("#pager");
	var container = $("#main-container");
	var containerHeight = container.height();
	var footerTop = ($(window).scrollTop()+$(window).height());
	if (bottomBarDefaultPos === null) bottomBarDefaultPos = footer.css("position");
	if (bottomBarDisplayStyle === null) bottomBarDisplayStyle = pager.css("display");
	if (footerTop > containerHeight) {
		footer.css({
			position: "static"
		});
		pager.css("display", "inline-block");
	}
	else {
		footer.css({
			position: bottomBarDefaultPos
		});
		pager.css("display", bottomBarDisplayStyle);
	}
};

editor.setTheme("ace/theme/chrome");
editor.renderer.setShowGutter(false);
editor.renderer.setShowPrintMargin(false);
editor.renderer.setPadding(20);
editor.renderer.setScrollMargin(8, 8, 0, 0);
editor.setHighlightActiveLine(false);
editor.getSession().setUseWrapMode(true);
editor.getSession().setMode("ace/mode/sql");
editor.setOptions({ maxLines: 5 });

$(window).resize(windowResize).scroll(positionFooter);
windowResize();

$(".no-propagate").on("click", function (el) { el.stopPropagation(); });

function loadDB() {
	setIsLoading(true);
	resetTableList();
	setTimeout(function () {
		var tables;
		try {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", "../data.sqlite");
			xhr.responseType = "arraybuffer";
			xhr.onload = function(e) {
				db = new SQL.Database(new Uint8Array(this.response));
				tables = db.prepare("SELECT * FROM sqlite_master WHERE type='table' ORDER BY name");
				var firstTableName = null;
				var tableList = $("#tables");
				while (tables.step()) {
					var rowObj = tables.getAsObject();
					var name = rowObj.name;
					if (firstTableName === null) firstTableName = name;
					var rowCount = getTableRowsCount(name);
					rowCounts[name] = rowCount;
					tableList.append('<option value="' + name + '">' + name + ' (' + rowCount + ' rows)</option>');
				}
				tableList.select2("val", firstTableName);
				doDefaultSelect(firstTableName);
				$("#output-box").fadeIn();
				$(".nouploadinfo").hide();
				$("#sample-db-link").hide();
				$("#dropzone").delay(50).animate({height: 50}, 500);
				$("#success-box").show();
				setIsLoading(false);
				};
				xhr.send();
			}
			catch (ex) {
				setIsLoading(false);
				alert(ex);
				return;
			}
		}, 50);
}

function getTableRowsCount(name) {
	var sel = db.prepare("SELECT COUNT(*) AS count FROM '" + name + "'");
	if (sel.step()) return sel.getAsObject().count;
	else return -1;
}

function getQueryRowCount(query) {
	if (query === lastCachedQueryCount.select) return lastCachedQueryCount.count;
	var queryReplaced = query.replace(SQL_SELECT_REGEX, "SELECT COUNT(*) AS count_sv FROM ");
	if (queryReplaced !== query) {
		queryReplaced = queryReplaced.replace(SQL_LIMIT_REGEX, "");
		var sel = db.prepare(queryReplaced);
		if (sel.step()) {
			var count = sel.getAsObject().count_sv;
			lastCachedQueryCount.select = query;
			lastCachedQueryCount.count = count;
			return count;
		}
		else return -1;
	}
	else return -1;
}

function getTableColumnTypes(tableName) {
	var result = [];
	var sel = db.prepare("PRAGMA table_info('" + tableName + "')");
	while (sel.step()) {
		var obj = sel.getAsObject();
		result[obj.name] = obj.type;
	}
	return result;
}

function resetTableList() {
	var tables = $("#tables");
	rowCounts = [];
	tables.empty();
	tables.append("<option></option>");
	tables.select2({
		placeholder: "Select a table",
		formatSelection: selectFormatter,
		formatResult: selectFormatter
	});
	tables.on("change", function (e) {
		doDefaultSelect(e.val);
	});
}

function setIsLoading(isLoading) {
	var dropText = $("#drop-text");
	var loading = $("#drop-loading");
	if (isLoading) {
		dropText.hide();
		loading.show();
	}
	else {
		dropText.show();
		loading.hide();
	}
}

function extractFileNameWithoutExt(filename) {
	var dotIndex = filename.lastIndexOf(".");
	if (dotIndex > -1) return filename.substr(0, dotIndex);
	else return filename;
}

function doDefaultSelect(name) {
	var defaultSelect = "SELECT * FROM '" + name + "' LIMIT 0,30";
	editor.setValue(defaultSelect, -1);
	renderQuery(defaultSelect);
}

function executeSql() {
	var query = editor.getValue();
	renderQuery(query);
	$("#tables").select2("val", getTableNameFromQuery(query));
}

function getTableNameFromQuery(query) {
	var sqlRegex = SQL_FROM_REGEX.exec(query);
	if (sqlRegex != null) return sqlRegex[1].replace(/"|'/gi, "");
	else return null;
}

function parseLimitFromQuery(query, tableName) {
	var sqlRegex = SQL_LIMIT_REGEX.exec(query);
	if (sqlRegex != null) {
		var result = {};
		if (sqlRegex.length > 2 && typeof sqlRegex[2] !== "undefined") {
			result.offset = parseInt(sqlRegex[1]);
			result.max = parseInt(sqlRegex[2]);
		}
		else {
			result.offset = 0;
			result.max = parseInt(sqlRegex[1]);
		}
		if (result.max == 0) {
			result.pages = 0;
			result.currentPage = 0;
			return result;
		}
		if (typeof tableName === "undefined") tableName = getTableNameFromQuery(query);
		var queryRowsCount = getQueryRowCount(query);
		if (queryRowsCount != -1) {
			result.pages = Math.ceil(queryRowsCount / result.max);
		}
		result.currentPage = Math.floor(result.offset / result.max) + 1;
		result.rowCount = queryRowsCount;
		return result;
	}
	else return null;
}

function setPage(el, next) {
	if ($(el).hasClass("disabled")) return;
	var query = editor.getValue();
	var limit = parseLimitFromQuery(query);
	var pageToSet;
	if (typeof next !== "undefined") pageToSet = (next ? limit.currentPage : limit.currentPage - 2 );
	else {
		var page = prompt("Go to page");
		if (!isNaN(page) && page >= 1 && page <= limit.pages) pageToSet = page - 1;
		else return;
	}
	var offset = (pageToSet * limit.max);
	editor.setValue(query.replace(SQL_LIMIT_REGEX, "LIMIT " + offset + "," + limit.max), -1);
	executeSql();
}

function refreshPagination(query, tableName) {
	var limit = parseLimitFromQuery(query, tableName);
	if (limit !== null && limit.pages > 0) {
		var pager = $("#pager");
		pager.attr("title", "Row count: " + limit.rowCount);
		pager.tooltip('fixTitle');
		pager.text(limit.currentPage + " / " + limit.pages);
		if (limit.currentPage <= 1) $("#page-prev").addClass("disabled");
		else $("#page-prev").removeClass("disabled");
		if ((limit.currentPage + 1) > limit.pages) $("#page-next").addClass("disabled");
		else $("#page-next").removeClass("disabled");
		$("#bottom-bar").show();
	}
	else $("#bottom-bar").hide();
}

function showError(msg) {
	$("#data").hide();
	$("#bottom-bar").hide();
	errorBox.show();
	errorBox.text(msg);
}

function htmlEncode(value) {
	return $('<div/>').text(value).html();
}

function renderQuery(query) {
	var dataBox = $("#data");
	var thead = dataBox.find("thead").find("tr");
	var tbody = dataBox.find("tbody");
	thead.empty();
	tbody.empty();
	errorBox.hide();
	dataBox.show();
	var columnTypes = [];
	var tableName = getTableNameFromQuery(query);
	if (tableName != null) columnTypes = getTableColumnTypes(tableName);
	var sel;
	try {
		sel = db.prepare(query);
	}
	catch (ex) {
		showError(ex);
		return;
	}
	var addedColums = false;
	while (sel.step()) {
		if (!addedColums) {
			addedColums = true;
			var columnNames = sel.getColumnNames();
			for (var i = 0; i < columnNames.length; i++) {
				var type = columnTypes[columnNames[i]];
				thead.append('<th><span data-toggle="tooltip" data-placement="top" title="' + type + '">' + columnNames[i] + "</span></th>");
			}
		}
		var tr = $('<tr>');
		var s = sel.get();
		for (var i = 0; i < s.length; i++) tr.append('<td><span title="' + htmlEncode(s[i]) + '">' + htmlEncode(s[i]) + '</span></td>');
		tbody.append(tr);
	}
	refreshPagination(query, tableName);
	$('[data-toggle="tooltip"]').tooltip({html: true});
	dataBox.editableTableWidget();
	setTimeout(function () {
		positionFooter();
	}, 100);
}
