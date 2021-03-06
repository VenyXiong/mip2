/**
 * @file util.js
 * @author sfe
 */

const regVar = /[\w\d-._]+/gmi
const regTplLike = /`[^`]+`/gmi
const regTpl = /(\${)([^}]+)(}.*)/gmi
const vendorNames = ['Webkit', 'Moz', 'ms']
let emptyStyle

export function isObject (obj) {
  return obj && Object.prototype.toString.call(obj) === '[object Object]'
}

export function isArray (obj) {
  return obj && obj.constructor === Array
}

export function objNotEmpty (obj) {
  return isObject(obj) && Object.keys(obj).length !== 0
}

export function arrayToObject (arr) {
  let obj = {}
  arr.forEach(item => {
    if (isObject(item)) {
      Object.assign(obj, item)
    } else {
      obj[item] = true
    }
  })
  return obj
}

export function parseClass (classSpecs) {
  if (isArray(classSpecs)) {
    classSpecs = arrayToObject(classSpecs)
  }

  let newClasses = {}
  if (isObject(classSpecs)) {
    Object.keys(classSpecs).forEach(k => {
      typeof classSpecs[k] !== 'undefined' && k && (newClasses[k] = classSpecs[k])
    })
    return newClasses
  }
}

export function parseStyle (styleSpecs) {
  let styles = {}

  if (isArray(styleSpecs)) {
    styleSpecs.forEach(styleObj => {
      styles = Object.assign(styles, parseStyle(styleObj))
    })
    return styles
  }
  if (!isObject(styleSpecs)) {
    return ''
  }

  Object.keys(styleSpecs).forEach(k => {
    let normalizedName = normalize(k)
    let newKey = normalizedName.replace(/[A-Z]/g, match => '-' + match.toLowerCase())
    let val = styleSpecs[k]
    if (isArray(val)) {
      let div = document.createElement('div')
      for (let i = 0, len = val.length; i < len; i++) {
        div.style[newKey] = val[i]
      }
      styles[newKey] = div.style[newKey]
    } else {
      styles[newKey] = val
    }
  })
  return styles
}

// autoprefixer
export function normalize (prop) {
  emptyStyle = emptyStyle || document.createElement('div').style
  prop = prop.replace(/-(\w)/g, (_, c) => (c ? c.toUpperCase() : ''))

  if (prop !== 'filter' && (prop in emptyStyle)) {
    return prop
  }

  const capName = prop.charAt(0).toUpperCase() + prop.slice(1)
  for (let i = 0; i < vendorNames.length; i++) {
    const name = vendorNames[i] + capName
    if (name in emptyStyle) {
      return name
    }
  }
}

export function styleToObject (style) {
  if (!style) {
    return {}
  }

  // etc: font-size:12px; => {fontSize: '12px'}
  let styles = style.split(';')
  let styleObj = {}
  for (let i = 0, len = styles.length; i < len; i++) {
    let item = styles[i]
    if (!item) {
      continue
    }
    let parts = item.split(':')
    styleObj[parts[0]] = parts[1]
  }
  return styleObj
}

export function objectToStyle (obj) {
  if (!isObject(obj)) {
    return ''
  }

  let styles = ''
  // etc: {fontSize: '12px'} => font-size:12px;
  Object.keys(obj).forEach(k => {
    styles += `${k}:${obj[k]};`
  })
  return styles
}

export function namespaced (str) {
  let newExp = ''
  let match = null
  let pointer = 0
  let tpls = []

  // deal with template-like str first and save results
  str = str.replace(regTplLike, (match) => {
    match = match.replace(regTpl, '$1this.$2$3')
    tpls.push(match)
    return `MIP-STR-TPL${tpls.length - 1}`
  })

  while ((match = regVar.exec(str)) != null) {
    let index = match['index']
    let matched = match[0]

    newExp += str.substring(pointer, index)

    pointer = index + matched.length

    // get template-like str result directly
    if (matched.indexOf('MIP-STR-TPL') !== -1) {
      newExp += tpls[+match[0].substr(11)]
      continue
    }
    // skip number or memberExpression that was left behind
    if (!isNaN(match[0]) || /^\./.test(match[0])) {
      newExp += match[0]
      continue
    }

    // to get the next not blankspace char of matched, to tell its nature
    let i = findChar(str, pointer, true)
    // not key of an obj or string warpped by quotes - vars
    if (i >= str.length || !/['`:]/.test(str[i])) {
      newExp += 'this.' + match[0]
    } else if (str[i] === ':') {
      i = findChar(str, index - 1, false)
      // tell if conditional operator ?:
      if (i < 0 || str[i] !== '?') {
        newExp += match[0]
      } else {
        newExp += 'this.' + match[0]
      }
    } else {
      newExp += match[0]
    }
  }
  newExp += str.substr(pointer)

  return newExp
}

function findChar (str, i, forward) {
  while (str[i] && str[i] === ' ') {
    forward ? (i++) : (i--)
  }
  return i
}
