/**
 * @file main entry
 * @author wangyisheng@baidu.com (wangyisheng)
 */

import {isSameRoute, getFullPath, convertPatternToRegexp} from './util/route'
import {
  getMIPShellConfig,
  addMIPCustomScript,
  createIFrame,
  getIFrame,
  frameMoveIn,
  frameMoveOut,
  createLoading
} from './util/dom'
import Debouncer from './util/debounce'
// import {supportsPassive} from './util/feature-detect'
import {scrollTo} from './util/ease-scroll'
import {
  NON_EXISTS_PAGE_ID,
  SCROLL_TO_ANCHOR_CUSTOM_EVENT,
  DEFAULT_SHELL_CONFIG,
  MESSAGE_APPSHELL_EVENT,
  MESSAGE_ROUTER_PUSH,
  MESSAGE_ROUTER_REPLACE,
  MESSAGE_SET_MIP_SHELL_CONFIG,
  MESSAGE_UPDATE_MIP_SHELL_CONFIG,
  MESSAGE_SYNC_PAGE_CONFIG,
  MESSAGE_REGISTER_GLOBAL_COMPONENT
  // MESSAGE_APPSHELL_HEADER_SLIDE_UP,
  // MESSAGE_APPSHELL_HEADER_SLIDE_DOWN,
} from './const/index'

import {customEmit} from '../vue-custom-element/utils/custom-event'
import util from '../util/index'
import viewport from '../viewport'
import Router from './router/index'
// import AppShell from './appshell'
import GlobalComponent from './appshell/globalComponent'
import '../styles/mip.less'

/**
 * use passive event listeners if supported
 * https://github.com/WICG/EventListenerOptions/blob/gh-pages/explainer.md
 */
// const eventListenerOptions = supportsPassive ? {passive: true} : false
const eventListenerOptions = false

class Page {
  constructor () {
    try {
      if (window.parent && window.parent.MIP_ROOT_PAGE) {
        this.isRootPage = false
      } else {
        window.MIP_ROOT_PAGE = true
        this.isRootPage = true
      }
    } catch (e) {
      // Cross domain error means root page
      window.MIP_ROOT_PAGE = true
      this.isRootPage = true
    }
    this.pageId = undefined

    // root page
    // this.appshell = undefined
    this.children = []
    this.currentPageId = undefined
    this.messageHandlers = []
    this.currentPageMeta = {}
    this.direction = undefined
    this.appshellRoutes = []
    this.appshellCache = Object.create(null)

    // sync from mip-shell
    this.transitionContainsHeader = true

    /**
     * transition will be executed only when `Back` button clicked,
     * due to a bug when going back with gesture in mobile Safari.
     */
    this.allowTransition = false
  }

  /**
   * clean pageId
   *
   * @param {string} pageId pageId
   * @return {string} cleaned pageId
   */
  cleanPageId (pageId) {
    let hashReg = /#.*$/
    return pageId && pageId.replace(hashReg, '')
  }

  initRouter () {
    let router

    // generate pageId
    this.pageId = this.cleanPageId(window.location.href)
    this.currentPageId = this.pageId

    if (this.isRootPage) {
      // outside iframe
      router = new Router()
      router.rootPage = this
      router.init()
      router.listen(this.render.bind(this))

      window.MIP_ROUTER = router

      // handle events emitted by child iframe
      this.messageHandlers.push((type, data) => {
        if (type === MESSAGE_ROUTER_PUSH) {
          router.push(data.route)
        } else if (type === MESSAGE_ROUTER_REPLACE) {
          router.replace(data.route)
        }
      })

      // handle events emitted by BaiduResult page
      window.MIP.viewer.onMessage('changeState', ({url}) => {
        router.replace(url)
      })
    } else {
      // inside iframe
      router = window.parent.MIP_ROUTER
      router.rootPage.addChild(this)
    }

    this.router = router
  }

  initAppShell () {
    if (this.isRootPage) {
      this.globalComponent = new GlobalComponent()
      this.messageHandlers.push((type, data) => {
        if (type === MESSAGE_SET_MIP_SHELL_CONFIG) {
          // Set mip shell config in root page
          this.appshellRoutes = data.shellConfig
          this.appshellCache = Object.create(null)
          this.currentPageMeta = this.findMetaByPageId(this.pageId)
          createLoading(this.currentPageMeta)

          // Set bouncy header
          if (!data.update && this.currentPageMeta.header.bouncy) {
            this.setupBouncyHeader()
          }
        } else if (type === MESSAGE_UPDATE_MIP_SHELL_CONFIG) {
          if (data.pageMeta) {
            this.appshellCache[data.pageId] = data.pageMeta
          } else {
            data.pageMeta = this.findMetaByPageId(data.pageId)
          }
          customEmit(window, 'mipShellEvents', {
            type: 'updateShell',
            data
          })
        } else if (type === MESSAGE_SYNC_PAGE_CONFIG) {
          // Sync config from mip-shell
          this.transitionContainsHeader = data.transitionContainsHeader
        } else if (type === MESSAGE_REGISTER_GLOBAL_COMPONENT) {
          // Register global component
          console.log('register global component')
          // this.globalComponent.register(data)
        }
      })

      // Set iframe height when resizing
      viewport.on('resize', () => {
        [].slice.call(document.querySelectorAll('.mip-page__iframe')).forEach($el => {
          $el.style.height = `${viewport.getHeight()}px`
        })
      })
    } else {
      this.messageHandlers.push((type, event) => {
        if (type === MESSAGE_APPSHELL_EVENT) {
          customEmit(window, event.name, event.data)
        }
      })

      let parentPage = window.parent.MIP.viewer.page
      let currentPageMeta = parentPage.findMetaByPageId(this.pageId)

      if (currentPageMeta.header.bouncy) {
        this.setupBouncyHeader()
      }
    }
  }

  /**
   * scroll to hash with ease transition
   *
   * @param {string} hash hash
   */
  scrollToHash (hash) {
    if (hash) {
      try {
        let $hash = document.querySelector(decodeURIComponent(hash))
        if ($hash) {
          // scroll to current hash
          scrollTo($hash.offsetTop, {
            scroller: viewport.scroller,
            scrollTop: viewport.getScrollTop()
          })
        }
      } catch (e) {}
    }
  }

  /**
   * listen to viewport.scroller, toggle header when scrolling up & down
   *
   */
  setupBouncyHeader () {
    const THRESHOLD = 10
    let scrollTop
    let lastScrollTop = 0
    let scrollDistance
    let scrollHeight = viewport.getScrollHeight()
    let viewportHeight = viewport.getHeight()
    let lastScrollDirection

    // viewportHeight = 0 before frameMoveIn animation ends
    // Wait a minute
    if (viewportHeight === 0) {
      setTimeout(this.setupBouncyHeader.bind(this), 100)
      return
    }

    this.debouncer = new Debouncer(() => {
      scrollTop = viewport.getScrollTop()
      scrollDistance = Math.abs(scrollTop - lastScrollTop)

      // ignore bouncy scrolling in iOS
      if (scrollTop < 0 || scrollTop + viewportHeight > scrollHeight) {
        return
      }

      if (lastScrollTop < scrollTop && scrollDistance >= THRESHOLD) {
        if (lastScrollDirection !== 'up') {
          lastScrollDirection = 'up'
          let target = this.isRootPage ? window : window.parent
          customEmit(target, 'mipShellEvents', {
            type: 'slide',
            data: {
              direction: 'up'
            }
          })
        }
      } else if (lastScrollTop > scrollTop && scrollDistance >= THRESHOLD) {
        if (lastScrollDirection !== 'down') {
          lastScrollDirection = 'down'
          let target = this.isRootPage ? window : window.parent
          customEmit(target, 'mipShellEvents', {
            type: 'slide',
            data: {
              direction: 'down'
            }
          })
        }
      }

      lastScrollTop = scrollTop
    })

    // use passive event listener to improve scroll performance
    viewport.scroller.addEventListener('scroll', this.debouncer, eventListenerOptions)
    this.debouncer.handleEvent()
  }

  /**
   * notify root page with an eventdata
   *
   * @param {Object} data eventdata
   */
  notifyRootPage (data) {
    if (this.isRootPage) {
      window.postMessage(data, window.location.origin)
    } else {
      window.parent.postMessage(data, window.location.origin)
    }
  }

  /**
   * destroy current page
   *
   */
  destroy () {
    viewport.scroller.removeEventListener('scroll', this.debouncer, false)
  }

  start () {
    // Don't let browser restore scroll position.
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    // Set global mark
    window.MIP.MIP_ROOT_PAGE = window.MIP_ROOT_PAGE

    this.initRouter()
    this.initAppShell()
    addMIPCustomScript()

    // Listen message from inner iframes
    window.addEventListener('message', (e) => {
      try {
        if (e.source.location.origin === window.location.origin) {
          this.messageHandlers.forEach(handler => {
            handler.call(this, e.data.type, e.data.data || {})
          })
        }
      } catch (e) {
        // Message sent from SF will cause cross domain error when reading e.source.location
        // Just ignore these messages.
      }
    }, false)

    // Job complete!
    document.body.setAttribute('mip-ready', '')

    // scroll to current hash if exists
    this.scrollToHash(window.location.hash)
    window.addEventListener(SCROLL_TO_ANCHOR_CUSTOM_EVENT, (e) => {
      this.scrollToHash(e.detail[0])
    })

    // document.body.addEventListener('click', function (e) {
    //   window.alert(e.target.tagName)
    // })
  }

  // ========================= Util functions for developers =========================
  togglePageMask (toggle, options) {
    // Only show page mask in root page
    if (!this.isRootPage) {
      customEmit(window.parent, 'mipShellEvents', {
        type: 'togglePageMask',
        data: {
          toggle,
          options
        }
      })
    }
  }

  toggleDropdown (toggle) {
    let target = this.isRootPage ? window : window.parent
    customEmit(target, 'mipShellEvents', {
      type: 'toggleDropdown',
      data: {
        toggle
      }
    })
  }

  // =============================== Root Page methods ===============================

  /**
   * emit a custom event in current page
   *
   * @param {Object} event event
   * @param {string} event.name event name
   * @param {Object} event.data event data
   */
  emitEventInCurrentPage ({name, data = {}}) {
    if (this.currentPageId !== this.pageId) {
      // notify current iframe
      let $iframe = getIFrame(this.currentPageId)
      $iframe && $iframe.contentWindow.postMessage({
        type: MESSAGE_APPSHELL_EVENT,
        data: {name, data}
      }, window.location.origin)
    } else {
      // emit CustomEvent in root page
      customEmit(window, name, data)
    }
  }

  /**
   * read <mip-shell> if provided
   *
   */
  readMIPShellConfig () {
    // read <mip-shell> and save in `data`
    this.appshellRoutes = getMIPShellConfig().routes || []

    this.appshellRoutes.forEach(route => {
      route.meta = util.fn.extend(true, {}, DEFAULT_SHELL_CONFIG, route.meta || {})
      route.regexp = convertPatternToRegexp(route.pattern || '*')

      // get title from <title> tag
      if (!route.meta.header.title) {
        route.meta.header.title = (document.querySelector('title') || {}).innerHTML || ''
      }
    })
  }

  /**
   * find route.meta by pageId
   * @param {string} pageId pageId
   * @return {Object} meta object
   */
  findMetaByPageId (pageId) {
    if (this.appshellCache[pageId]) {
      return this.appshellCache[pageId]
    } else {
      let route
      for (let i = 0; i < this.appshellRoutes.length; i++) {
        route = this.appshellRoutes[i]
        if (route.regexp.test(pageId)) {
          this.appshellCache[pageId] = route.meta
          return route.meta
        }
      }
    }

    return Object.assign({}, DEFAULT_SHELL_CONFIG)
  }

  /**
   * refresh appshell with data from <mip-shell>
   *
   * @param {string} targetPageId targetPageId
   * @param {Object} extraData extraData
   */
  // refreshAppShell (targetPageId, extraData) {
  //   this.appshell.refresh(extraData, targetPageId)
  // }

  /**
   * save scroll position in root page
   */
  saveScrollPosition () {
    this.rootPageScrollPosition = viewport.getScrollTop()
  }

  /**
   * restore scroll position in root page
   */
  restoreScrollPosition () {
    viewport.scroller.scrollTo(0, this.rootPageScrollPosition)
  }

  /**
   * apply transition effect to relative two pages
   *
   * @param {string} targetPageId targetPageId
   * @param {Object} targetMeta metainfo of targetPage
   * @param {Object} options
   * @param {Object} options.newPage if just created a new page
   * @param {Function} options.onComplete if just created a new page
   */
  applyTransition (targetPageId, targetMeta, options = {}) {
    let localMeta = this.findMetaByPageId(targetPageId)
    /**
     * priority of header.title:
     * 1. <a mip-link data-title>
     * 2. <mip-shell> route.meta.header.title
     * 3. <a mip-link></a> innerText
     */
    let innerTitle = {title: targetMeta.defaultTitle || undefined}
    let finalMeta = util.fn.extend(true, innerTitle, localMeta, targetMeta)

    customEmit(window, 'mipShellEvents', {
      type: 'toggleTransition',
      data: {
        toggle: false
      }
    })

    if (targetPageId === this.pageId || this.direction === 'back') {
      // backward
      let backwardOpitons = {
        transition: this.allowTransition,
        sourceMeta: this.currentPageMeta,
        transitionContainsHeader: this.transitionContainsHeader,
        onComplete: () => {
          this.allowTransition = false
          this.currentPageMeta = finalMeta
          customEmit(window, 'mipShellEvents', {
            type: 'toggleTransition',
            data: {
              toggle: true
            }
          })
          options.onComplete && options.onComplete()
        }
      }

      if (this.direction === 'back') {
        backwardOpitons.targetPageId = targetPageId
      }

      this.getElementsInRootPage().forEach(e => e.classList.remove('hide'))
      frameMoveOut(this.currentPageId, backwardOpitons)

      this.direction = null
      // restore scroll position in root page
      if (targetPageId === this.pageId) {
        this.restoreScrollPosition()
      }
    } else {
      // forward
      frameMoveIn(targetPageId, {
        transition: this.allowTransition,
        targetMeta: finalMeta,
        newPage: options.newPage,
        transitionContainsHeader: this.transitionContainsHeader,
        onComplete: () => {
          this.allowTransition = false
          this.currentPageMeta = finalMeta
          // TODO: Prevent transition on first view in some cases
          customEmit(window, 'mipShellEvents', {
            type: 'toggleTransition',
            data: {
              toggle: true
            }
          })
          /**
           * Disable scrolling of root page when covered by an iframe
           * NOTE: it doesn't work in iOS, see `_lockBodyScroll()` in viewer.js
           */
          this.getElementsInRootPage().forEach(e => e.classList.add('hide'))
          options.onComplete && options.onComplete()
        }
      })
    }
  }

  /**
   * add page to `children`
   *
   * @param {Page} page page
   */
  addChild (page) {
    if (this.isRootPage) {
      this.children.push(page)
    }
  }

  /**
   * get page by pageId
   *
   * @param {string} pageId pageId
   * @return {Page} page
   */
  getPageById (pageId) {
    return (!pageId || pageId === this.pageId)
      ? this : this.children.find(child => child.pageId === pageId)
  }

  /**
   * get elements in root page, except some shared by all the pages
   *
   * @return {Array<HTMLElement>} elements
   */
  getElementsInRootPage () {
    let whitelist = [
      '.mip-page__iframe',
      '.mip-page-loading-wrapper',
      'mip-shell',
      '[mip-shell]',
      '.mip-shell-header-wrapper',
      '.mip-shell-more-button-mask',
      '.mip-shell-more-button-wrapper',
      '.mip-shell-header-mask',
      '[mip-global-component]'
    ]
    let notInWhitelistSelector = whitelist.map(selector => `:not(${selector})`).join('')
    return document.body.querySelectorAll(`body > ${notInWhitelistSelector}`)
  }

  /**
   * render with current route
   *
   * @param {Route} from route
   * @param {Route} to route
   */
  render (from, to) {
    /**
     * if `to` route is the same with `from` route in path & query,
     * scroll in current page
     */
    if (isSameRoute(from, to, true)) {
      this.emitEventInCurrentPage({
        name: SCROLL_TO_ANCHOR_CUSTOM_EVENT,
        data: to.hash
      })
      return
    }

    // otherwise, render target page
    let targetFullPath = getFullPath(to)
    let targetPageId = this.cleanPageId(targetFullPath)
    let targetPage = this.getPageById(targetPageId)

    if (this.currentPageId === this.pageId) {
      this.saveScrollPosition()
    }

    // Hide page mask and skip transition
    customEmit(window, 'mipShellEvents', {
      type: 'togglePageMask',
      data: {
        toggle: false,
        options: {
          skipTransition: true
        }
      }
    })

    // Show header
    customEmit(window, 'mipShellEvents', {
      type: 'slide',
      data: {
        direction: 'down'
      }
    })

    /**
     * reload iframe when <a mip-link> clicked even if it's already existed.
     * NOTE: forwarding or going back with browser history won't do
     */
    if (!targetPage || (to.meta && to.meta.reload)) {
      // when reloading root page...
      if (this.pageId === targetPageId) {
        this.pageId = NON_EXISTS_PAGE_ID
        // destroy root page first
        if (targetPage) {
          targetPage.destroy()
        }
        // TODO: delete DOM & trigger disconnectedCallback in root page
        this.getElementsInRootPage().forEach(el => el.parentNode && el.parentNode.removeChild(el))
      }
      // Create a new iframe
      createIFrame(targetFullPath, targetPageId)
      this.applyTransition(targetPageId, to.meta, {newPage: true})
    } else {
      this.applyTransition(targetPageId, to.meta, {
        onComplete: () => {
          // Update shell if new iframe has not been created
          let pageMeta = this.findMetaByPageId(targetPageId)
          customEmit(window, 'mipShellEvents', {
            type: 'updateShell',
            data: {pageMeta}
          })
        }
      })
      window.MIP.$recompile()
    }

    this.currentPageId = targetPageId
  }
}

export default Page
