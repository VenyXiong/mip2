/**
 * @file Hash Function. Support hash get function
 * @author zhangzhiqiang(zhiqiangzhang37@163.com)
 */

/* global top screen location */

import event from './util/dom/event'
import css from './util/dom/css'
import Gesture from './util/gesture/index'
import platform from './util/platform'
import EventAction from './util/event-action'
import EventEmitter from './util/event-emitter'
import fn from './util/fn'
import {getOriginalUrl} from './util'
import {supportsPassive, isPortrait} from './page/util/feature-detect'
import viewport from './viewport'
import Page from './page/index'
import {MESSAGE_ROUTER_PUSH, MESSAGE_ROUTER_REPLACE, MESSAGE_PAGE_RESIZE} from './page/const/index'
import Messager from './messager'
import fixedElement from './fixed-element'

/**
 * Save window.
 *
 * @inner
 * @type {Object}
 */
const win = window

const eventListenerOptions = supportsPassive ? {passive: true} : false

/**
 * The mip viewer.Complement native viewer, and solve the page-level problems.
 */
let viewer = {

  /**
     * The initialise method of viewer
     */
  init () {
    /**
     * Send Message
     *
     * @inner
     * @type {Object}
     */
    this.messager = new Messager()

    /**
     * The gesture of document.Used by the event-action of Viewer.
     *
     * @private
     * @type {Gesture}
     */
    this._gesture = new Gesture(document, {
      preventX: false
    })

    this.setupEventAction()
    // handle preregistered  extensions
    this.handlePreregisteredExtensions()

    // add normal scroll class to body. except ios in iframe.
    // Patch for ios+iframe is default in mip.css
    if (!platform.needSpecialScroll) {
      document.documentElement.classList.add('mip-i-android-scroll')
      document.body.classList.add('mip-i-android-scroll')
    }

    if (this.isIframed) {
      this.patchForIframe()
      this._viewportScroll()
      if (platform.isIos()) {
        this._lockBodyScroll()
      }
    }

    this.page = new Page()

    this.page.start()

    this.fixedElement = fixedElement
    fixedElement.init()

    // Only send at first time
    if (win.MIP.viewer.page.isRootPage) {
      this.sendMessage('mippageload', {
        time: Date.now(),
        title: encodeURIComponent(document.title)
      })
    }

    event.delegate(document, 'input', 'blur', event => {
      this.page.notifyRootPage({
        type: MESSAGE_PAGE_RESIZE
      })
    }, true)

    // proxy <a mip-link>
    this._proxyLink(this.page)
  },

  /**
   * whether in an <iframe> ?
   * **Important** if you want to know whether in BaiduResult page, DO NOT use this flag
   *
   * @type {Boolean}
   * @public
   */
  isIframed: win !== top,

  /**
   * Patch for iframe
   */
  patchForIframe () {
    // Fix iphone 5s UC and ios 9 safari bug.
    // While the back button is clicked,
    // the cached page has some problems.
    // So we are forced to load the page in iphone 5s UC
    // and iOS 9 safari.
    let iosVersion = platform.getOsVersion()
    iosVersion = iosVersion ? iosVersion.split('.')[0] : ''
    let needBackReload = (iosVersion === '8' && platform.isUc() && screen.width === 320) ||
            (iosVersion === '9' && platform.isSafari())
    if (needBackReload) {
      window.addEventListener('pageshow', e => {
        if (e.persisted) {
          document.body.style.display = 'none'
          location.reload()
        }
      })
    }
  },

  /**
   * Show contents of page. The contents will not be displayed until the components are registered.
   */
  show () {
    css(document.body, {
      opacity: 1,
      animation: 'none'
    })
    this.isShow = true
    this._showTiming = Date.now()
    this.trigger('show', this._showTiming)
  },

  /**
   * Send message to BaiduResult page,
   * including following types:
   * 1. `pushState` when clicking a `<a mip-link>` element (called 'loadiframe')
   * 2. `mipscroll` when scrolling inside an iframe, try to let parent page hide its header.
   * 3. `mippageload` when current page loaded
   * 4. `performance_update`
   *
   * @param {string} eventName
   * @param {Object} data Message body
   */
  sendMessage (eventName, data = {}) {
    if (!win.MIP.standalone) {
      this.messager.sendMessage(eventName, data)
    }
  },

  onMessage (eventName, callback) {
    if (!win.MIP.standalone) {
      this.messager.on(eventName, callback)
    }
  },

  /**
   * Setup event-action of viewer. To handle `on="tap:xxx"`.
   */
  setupEventAction () {
    let hasTouch = fn.hasTouch()
    let eventAction = this.eventAction = new EventAction()
    if (hasTouch) {
      // In mobile phone, bind Gesture-tap which listen to touchstart/touchend event
      // istanbul ignore next
      this._gesture.on('tap', event => {
        eventAction.execute('tap', event.target, event)
      })
    } else {
      // In personal computer, bind click event, then trigger event. eg. `on=tap:sidebar.open`, when click, trigger open() function of #sidebar
      document.addEventListener('click', event => {
        eventAction.execute('tap', event.target, event)
      }, false)
    }

    document.addEventListener('click', event => {
      eventAction.execute('click', event.target, event)
    }, false)

    // istanbul ignore next
    event.delegate(document, 'input', 'change', event => {
      eventAction.execute('change', event.target, event)
    })
  },

  /**
   * Setup event-action of viewer. To handle `on="tap:xxx"`.
   */
  handlePreregisteredExtensions () {
    window.MIP = window.MIP || {}
    window.MIP.push = extensions => {
      if (extensions && typeof extensions.func === 'function') {
        extensions.func()
      }
    }
    let preregisteredExtensions = window.MIP.extensions
    if (preregisteredExtensions && preregisteredExtensions.length) {
      for (let i = 0; i < preregisteredExtensions.length; i++) {
        let curExtensionObj = preregisteredExtensions[i]
        if (curExtensionObj && typeof curExtensionObj.func === 'function') {
          curExtensionObj.func()
        }
      }
    }
  },

  /**
   *
   * @param {string} to Target url
   * @param {Object} options
   * @param {boolean} options.isMipLink Whether targetUrl is a MIP page. If not, use `top.location.href`. Defaults to `true`
   * @param {boolean} options.replace If true, use `history.replace` instead of `history.push`. Defaults to `false`
   * @param {Object} options.state Target page info
   */
  open (to, {isMipLink = true, replace = false, state} = {}) {
    let {router, isRootPage} = this.page
    let notifyRootPage = this.page.notifyRootPage.bind(this.page)
    if (!state) {
      state = {click: undefined, title: undefined, defaultTitle: undefined}
    }

    let hash = ''
    if (to.lastIndexOf('#') > -1) {
      hash = to.substring(to.lastIndexOf('#'))
    }
    let isHashInCurrentPage = hash && to.indexOf(window.location.origin + window.location.pathname) > -1

    // invalid <a>, ignore it
    if (!to) {
      return
    }

    /**
     * we handle two scenario:
     * 1. <mip-link>
     * 2. anchor in same page, scroll to current hash with an ease transition
     */
    if (isMipLink || isHashInCurrentPage) {
      // create target route
      let targetRoute = {path: to}

      // send statics message to BaiduResult page
      let pushMessage = {
        url: getOriginalUrl(to),
        state
      }

      this.sendMessage('pushState', pushMessage)

      if (isMipLink) {
        // reload page even if it's already existed
        targetRoute.meta = {
          reload: true,
          allowTransition: isPortrait(), // show transition only in portrait mode
          header: {
            title: pushMessage.state.title,
            defaultTitle: pushMessage.state.defaultTitle
          }
        }
      }

      // handle <a mip-link replace> & hash
      if (isHashInCurrentPage || replace) {
        if (isRootPage) {
          router.replace(targetRoute)
        } else {
          notifyRootPage({
            type: MESSAGE_ROUTER_REPLACE,
            data: {route: targetRoute}
          })
        }
      } else if (isRootPage) {
        router.push(targetRoute)
      } else {
        notifyRootPage({
          type: MESSAGE_ROUTER_PUSH,
          data: {route: targetRoute}
        })
      }
    } else {
      // jump in top window directly
      top.location.href = to
    }
  },

  /**
   * Event binding callback.
   * For overridding _bindEventCallback of EventEmitter.
   *
   * @private
   * @param {string} name
   * @param {Function} handler
   */
  _bindEventCallback (name, handler) {
    if (name === 'show' && this.isShow && typeof handler === 'function') {
      handler.call(this, this._showTiming)
    }
  },

  /**
   * Listerning viewport scroll
   *
   * @private
   */
  _viewportScroll () {
    let self = this
    let dist = 0
    let direct = 0
    let scrollTop = viewport.getScrollTop()
    // let lastDirect;
    let scrollHeight = viewport.getScrollHeight()
    let lastScrollTop = 0
    let wrapper = viewport.scroller

    wrapper.addEventListener('touchstart', e => {
      scrollTop = viewport.getScrollTop()
      scrollHeight = viewport.getScrollHeight()
    }, eventListenerOptions)

    function pagemove (e) {
      scrollTop = viewport.getScrollTop()
      scrollHeight = viewport.getScrollHeight()
      if (scrollTop > 0 && scrollTop < scrollHeight) {
        if (lastScrollTop < scrollTop) {
          // down
          direct = 1
        } else if (lastScrollTop > scrollTop) {
          // up
          direct = -1
        }
        dist = lastScrollTop - scrollTop
        lastScrollTop = scrollTop
        if (dist > 10 || dist < -10) {
          // 转向判断，暂时没用到，后续升级需要
          // lastDirect = dist / Math.abs(dist);
          self.sendMessage('mipscroll', {direct, dist})
        }
      } else if (scrollTop === 0) {
        self.sendMessage('mipscroll', {direct: 0})
      }
    }
    wrapper.addEventListener('touchmove', event => pagemove(event), eventListenerOptions)
    wrapper.addEventListener('touchend', event => pagemove(event))
  },

  /**
   * Proxy all the links in page.
   *
   * @private
   */
  _proxyLink (page = {}) {
    let self = this
    let httpRegexp = /^http/
    let telRegexp = /^tel:/

    /**
     * if an <a> tag has `mip-link` or `data-type='mip'` let router handle it,
     * otherwise let TOP jump
     */
    event.delegate(document, 'a', 'click', function (event) {
      let $a = this

      /**
       * browser will resolve fullpath, including path, query & hash
       * eg. http://localhost:8080/examples/page/tree.html?a=b#hash
       * don't use `$a.getAttribute('href')`
       */
      let to = $a.href
      let isMipLink = $a.hasAttribute('mip-link') || $a.getAttribute('data-type') === 'mip'
      let replace = $a.hasAttribute('replace')
      let state = self._getMipLinkData.call($a)

      /**
       * For mail、phone、market、app ...
       * Safari failed when iframed. So add the `target="_top"` to fix it. except uc and tel.
       */
      if (platform.isUc() && telRegexp.test(to)) {
        return
      }
      if (!httpRegexp.test(to)) {
        this.setAttribute('target', '_top')
        return
      }

      self.open(to, {isMipLink, replace, state})

      event.preventDefault()
    }, false)
  },

  /**
   * get alink postMessage data
   *
   * @return {Object} messageData
   */
  _getMipLinkData () {
    // compatible with MIP1
    let parentNode = this.parentNode

    return {
      click: this.getAttribute('data-click') || parentNode.getAttribute('data-click') || undefined,
      title: this.getAttribute('data-title') || parentNode.getAttribute('title') || undefined,
      defaultTitle: this.innerText.trim().split('\n')[0] || undefined
    }
  },

  /**
   * lock body scroll in iOS
   *
   * https://medium.com/jsdownunder/locking-body-scroll-for-all-devices-22def9615177
   * http://blog.christoffer.online/2015-06-10-six-things-i-learnt-about-ios-rubberband-overflow-scrolling/
   */
  _lockBodyScroll () {
    viewport.on('scroll', () => {
      let scrollTop = viewport.getScrollTop()
      if (scrollTop === 0) {
        viewport.setScrollTop(1)
      }
    }, eventListenerOptions)
  }
}

EventEmitter.mixin(viewer)

export default viewer
