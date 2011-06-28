//William Zimrin and Jeanette Miranda
//tracer.js	6/02/2011

//----- GENERAL HELPERS -----

function toInt(cssString) {
    return parseInt(cssString.substring(0, cssString.length - 2))
}

//creates a dom element of the type tag
function element(tag) {
    return $("<"+tag+'/>')
}

//----- CODE PANE HELPERS -----

function clearHighlight(el) {
    if (el.data("text")) {
        el.empty()
        el.text(el.data("text"))
        el.data("text",false)
    }
}

//Highlight the span of text beginning at idx in el
function highlightSpan(el,idx,span) {
    clearHighlight(el)
    var text = el.text()
    var startIdx = idx-1
    var endIdx = idx+span-1
    var beginText = text.substring(0,startIdx)
    var highlightedText = text.substring(startIdx,endIdx)
    var endText = text.substring(endIdx)
    el.data("text",text)
    el.empty()
    var hi = element("span")
    hi.addClass("highlight")
    hi.text(highlightedText)
    el.append(beginText,hi,endText)
}

//----- EXPANDABLE HELPERS -----

//Choose to display the full or short version of an expandable argument
function updateExpandable(html) {
    if (html.data("expanded"))
        html.text(html.data("full"))
    else
        html.text(html.data("short"))
}

//Toggle between the full and short version of an expandable argument
function toggleExpandable(html) {
    html.data("expanded",!html.data("expanded"))
    updateExpandable(html)
}

//----- CALL TABLE HELPERS -----

//Makes a cell on the call table, either an actual or a result
function makeCell(formShort, formFull, cssClass) {
    var TD = element("td")
    TD.addClass(cssClass + " cell")

    var div = element("div")
    //If a shortened form exists form exists
    if (formShort != formFull) {
        div.addClass("expandable")
        div.data({short: formShort, full: formFull, expanded: false})
        updateExpandable(div)
    }
    else {
        div.text(formFull)
    }
    TD.append(div)
    return TD
}

//Formats function name, actuals and result into table form
function makeCallTable(node) {
    var table = element("table")
    table.addClass("callTable")
    var row = element("tr")

    //Function name
    var nameTD = element("td")
    nameTD.text(node.name)
    nameTD.addClass("name cell")
    nameTD.data({idx: node.idx, span: node.span, linum: node.linum})
    row.append(nameTD)

    //Formals and actuals
    for (var i = 0; i < node.actuals.length; i++) {
        //Display in collapsed form if actualsExpanded is undefined or false
        var actual = makeCell(node.actualsShort[i],node.actuals[i],"arg")
        row.append(actual)
    }

    //Arrow
    var arrow = element('td')
    arrow.html("&rarr;")
    arrow.addClass("arrow cell")
    row.append(arrow)

    //Result
    resultTD = makeCell(node.resultShort,node.result,false,"result")
    row.append(resultTD)

    table.append(row)
    return table
}

//----- VISIBILITY HELPERS -----

//sets whether obj is hidden
function setHide(obj,hidden,animate) {
    if (hidden)
        obj.hide(animate)
    else
        obj.show(animate)
}

//Makes a call display the appropriate amount of info
function updateCall(html,animate) {
    var expanded = html.data("expanded")
    var hidable = html.data("hidable")
    var button = html.data("button")
    
    for (var i = 0; i < hidable.length; i++) {
        setHide(hidable[i],!expanded,animate)
    }
    
    if (expanded) 
        button.text("-")
    else 
        button.text("+")        
}

//Expand/collapses a call
function toggleCall(html,animate) {
    html.data("expanded",!html.data("expanded"))
    updateCall(html,animate)
}

//Bring parent calls with on scroll
function refocusScreen()
{
    //Find all visible calls
    visibleCalls = $("div#tracer").find(".call").filter(":visible")

    //Check the alignment of each visible call
    visibleCalls.each(function(index) {
        var callTable = $(this).children(".callTable").first()
        var button = $(this).children(".button").first()
        var callTableMarL = toInt(callTable.css('marginLeft'))
        var fromLeft = $(this).position().left
                        + toInt($(this).css('marginLeft'))
                        + callTableMarL
                        - $("div#tracerWrapper").scrollLeft()
        
        //only move callTables that are less wide than the current width
        //of the call (will this condition always be true?)
        if(callTable.width() < $(this).width()) {
            //This call is off the screen to the left
            if(fromLeft < 0) {
                //Want a maximum margin with right edge of callTable aligned
                //to right edge of call
                var shiftBy = Math.min($(this).width()-callTable.width(), 
                                        callTableMarL-fromLeft)
                callTable.css('marginLeft', shiftBy)
                button.css('marginLeft', shiftBy)
            }
            //This call is to the right of the left edge of the screen
            //And not aligned with its left edge
            else if (fromLeft > 0 && callTableMarL > 0) {
                //Want a minimum margin of 3
                callTable.css('marginLeft', Math.max(3, callTableMarL-fromLeft))
                button.css('marginLeft', Math.max(3, callTableMarL-fromLeft))
            }
        }
    })
}

//----- BUILDING CALLS -----

//Makes an expandedCall: delete button, function, formals, actuals and result
//All in their appropriate expanded or unexpanded form
function makeCall(traceNode, parent) {
    parent = $(parent)

    var call = element("div")
    if (parent.hasClass("background1"))
        call.addClass("background2")
    else
        call.addClass("background1")
    call.addClass("call")
    
    var callTable = makeCallTable(traceNode)

    var button = element("div")
    button.text("-")
    button.addClass("button")

    var hidable = []
    
    var lowerDiv = element("div")
    lowerDiv.addClass("childTableParent")
    var childTable = element('table')
    hidable.push(lowerDiv)
    childTable.addClass("childTable")
    var lowerRow = element('tr');
    childTable.append(lowerRow)

    for (var i = 0; i < traceNode.children.length; i++) {
        var cell = element('td')
        collapsedDiv = makeCall(traceNode.children[i],call);
        cell.append(collapsedDiv)
        lowerRow.append(cell);
    }
    
    lowerDiv.append(childTable)
    call.append(callTable)
    if (traceNode.children.length!=0)
        call.append(button)
    call.append(lowerDiv)
    call.data("expanded",false)
    call.data("hidable",hidable)
    call.data("button",button)

    updateCall(call)
    return call
}

//----- CREATING PAGE -----

$(document).ready(function () {
    //Check for browser compatibility
    if(!($.browser.webkit || $.browser.mozilla)) {
        alert("The Tracer has not been tested on your browser and may have compatibility issues. We suggest using Firefox, Chrome or Safari.")
    }

    var tabs = $("#tabbar")
    var bodyWrapper = $("#tracerWrapper")
    var bodies = $("#tracer")

    var codePane = $("#codePane")
    var codePaneWrapper = $("#codePaneWrapper")
    var codePaneButton = $("#codePaneButton")
    codePane.text(code)
    var codePaneWidth

    var ul = element("ul")
    ul.addClass("tabs")
    tabs.append(ul)
    var first = false
    for (var i = 0; i < theTrace.children.length; i++) {
        var li = element("li")
        if (!first)
            first = li
        li.text(theTrace.children[i].name)
        li.addClass("other")
        ul.append(li)
        var exp = makeCall(theTrace.children[i],tabs)
        exp.addClass("toplevel")
        li.data("child",exp)
        bodies.append(exp)
    }

    // -------------------------------------------------------------------------
    //                                      EVENTS
    // -------------------------------------------------------------------------
    

    //Set the width of the code pane to a new value and animate
    function setCodePaneWidth(newWidth) {
        if (codePaneWidth != newWidth) {
            codePaneWidth = newWidth
            codePaneWrapper.animate({"width":newWidth+"%"}, "slow")
            bodyWrapper.animate({"width":(100-newWidth)+"%"},
                                           "slow")
        }
    }

    var collapsedCodePaneWidth = 10
    var expandedCodePaneWidth = 50
    //Expand the code pane
    function expandCodePane() {
        setCodePaneWidth(expandedCodePaneWidth)
        codePaneButton.html("&raquo;")
    }
    //Collapse the code pane
    function collapseCodePane() {
        setCodePaneWidth(collapsedCodePaneWidth)
        codePaneButton.html("&laquo;")
    }
    
    //Expand and collapse codePane on click 
    codePaneButton.click(function () {
        if (codePaneWidth==expandedCodePaneWidth)
            collapseCodePane()
        else
            expandCodePane()
    })
    
    //Begin with a collapsed code pane
    collapseCodePane()
    
    //Animate to move to new highlighted code if necessary
    function showSpan() {
        var span = codePane.find("span")
        var pos = span.position()
        var height = codePane.height()
        var width = codePane.width()
        //If new span is off the displayed portion of the code
        codePane.animate({scrollTop: pos.top-(height/2)+codePane.scrollTop(),
                          scrollLeft: pos.left-(width/2)+codePane.scrollLeft()}, 
                         'slow')
    }

    var lastFunctionHighlighted;
    
    //Function names on click
    $("td.name").click(function () {
        if (lastFunctionHighlighted == this) {
            lastFunctionHighlighted = false;
            clearHighlight(codePane)
            collapseCodePane()
        } else {
            var target = $(this)
            highlightSpan(codePane,target.data("idx"),target.data("span"))
            expandCodePane()
            showSpan()
            lastFunctionHighlighted = this;
        }
    })
    
    //makes the expand/collapse buttons work
    $('.button').bind('click',function(event) {
        thisCall = $(this).parents(".call").first()
        toggleCall(thisCall,"fast")
    })

    bodyWrapper.scroll(refocusScreen)

    //makes the expandables expand/collapse appropriately
    //and highlight on hover
    $(".expandable").bind("click",function (event) {//expand/collapse
        toggleExpandable($(this))
    })

    //makes the tabs switch what is displayed and
    //highlight on hover
    $('ul.tabs li.other').bind('click', function (event) {//switch display
        target = $(this)
        var div = $("#tracer")
        $(".toplevel").hide()
        var child = target.data("child")
        child.show()
        var oldPicked = $("ul.tabs li.picked")
        oldPicked.removeClass("picked")
        oldPicked.addClass("other")
        target.addClass("picked")
        target.removeClass("other")
        $(bodyWrapper).scrollLeft(0)
        refocusScreen()
    })

    first.trigger("click")
    
    function setContentHeight() {
        $(".column").height($(window).height()-$("div#tabbar").height()
                            -2*parseInt($(document.body).css("margin-top")))
        codePane.height(codePaneWrapper.height()-codePaneButton.outerHeight(true))
    }

    setContentHeight()
    
    $(window).resize(setContentHeight)
    
    bodies.mousedown(function (event) {
        var oldX=event.pageX
        var oldY=event.pageY
        var body = $(document.body)
        body.addClass("dragging")

        function moveHandler(event) {
            var newTime = new Date().getTime()
            var newX = event.pageX
            var newY = event.pageY
            bodyWrapper.scrollLeft(bodyWrapper.scrollLeft()-newX+oldX)
            bodyWrapper.scrollTop(bodyWrapper.scrollTop()-newY+oldY)
            oldX=newX
            oldY=newY
            return false
        }
        function endHandler(event) {
            var newX = event.pageX
            var newY = event.pageY
            bodyWrapper.scrollLeft(bodyWrapper.scrollLeft()-newX+oldX)
            bodyWrapper.scrollTop(bodyWrapper.scrollTop()-newY+oldY)
            body.unbind("mousemove",moveHandler)
            body.unbind("mouseup",endHandler)
            body.unbind("mouseleave",endHandler)
            body.removeClass("dragging")
            return false
        }
        
        body.mousemove(moveHandler)
        body.mouseup(endHandler)
        body.mouseleave(endHandler)
        return false
    })
})
