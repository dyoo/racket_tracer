#lang racket

(require (prefix-in kernel: syntax/kerncase)
         gui-debugger/marks
         mzlib/etc
         (prefix-in srfi: srfi/1/search)
         (for-syntax scheme/base)
         (only-in mzscheme [apply plain-apply]))

(define (arglist-bindings arglist-stx)
    (syntax-case arglist-stx ()
      [var
       (identifier? arglist-stx)
       (list arglist-stx)]
      [(var ...)
       (syntax->list arglist-stx)]
      [(var . others)
       (cons #'var (arglist-bindings #'others))]))

(define annotate-stx
  (opt-lambda (stx break-wrap record-bound-id record-top-level-id [source #f])
    
    (define breakpoints (make-hasheq))
    
    (define (previous-bindings bound-vars)
      (if (null? bound-vars)
          #'null
          #'(#%plain-app debugger-local-bindings)))
    
    (define (top-level-annotate stx)
      (kernel:kernel-syntax-case/phase
       stx (namespace-base-phase)
       [(module identifier name (plain-module-begin . module-level-exprs))
        (with-syntax ([(module . _) stx])
          (quasisyntax/loc stx (module identifier name
                                 (plain-module-begin 
                                  #,@(map (lambda (e) (module-level-expr-iterator
                                                       e (list (syntax-e #'identifier)
                                                               (syntax-source #'identifier))))
                                          (syntax->list #'module-level-exprs))))))]
       [else-stx
        (general-top-level-expr-iterator stx  #f)]))
    
    (define (module-level-expr-iterator stx module-name )
      (kernel:kernel-syntax-case
       stx #f
       [(#%provide . provide-specs)
        stx]
       [else-stx
        (general-top-level-expr-iterator stx module-name )]))
    
    (define (general-top-level-expr-iterator stx module-name )
      (kernel:kernel-syntax-case
       stx #f
       [(define-values (var ...) expr)
        
        (begin
          (for-each (lambda (v) (record-bound-id 'bind v v))
                    (syntax->list #'(var ...)))
          (quasisyntax/loc stx
            (begin (define-values (var ...) #,(annotate #`expr '() #t module-name))
                   #,(if (syntax-source stx)
                         #`(begin (#%plain-app 
                                   #,record-top-level-id '#,module-name #'var (case-lambda
                                                                                [() var]
                                                                                [(v) (set! var v)])) ...)
                         #'(#%plain-app void))
                   (#%plain-app void)))
          )
        ]
       [(define-syntaxes (var ...) expr)
        stx]
       [(define-values-for-syntax (var ...) expr)
        ;; define-values-for-syntax's RHS is compile time, so treat it
        ;; like define-syntaxes
        stx]
       [(begin . top-level-exprs)
        (quasisyntax/loc stx (begin #,@(map (lambda (expr)
                                              (module-level-expr-iterator expr module-name ))
                                            (syntax->list #'top-level-exprs))))]
       [(#%require . require-specs)
        stx]
       [else
        (annotate stx '() #f module-name )]))
    
    (define (annotate expr bound-vars is-tail? module-name)
      
      (define annotate-break?
        (let ([pos (syntax-position expr)]
              [src (syntax-source expr)])
          (and src pos
               (hash-ref breakpoints pos (lambda () #t))
               (kernel:kernel-syntax-case
                expr #f
                [(if test then else) #t]
                [(begin . bodies) #t]
                [(begin0 . bodies) #t]
                [(let-values . clause) #t]
                [(letrec-values . clause) #t]
                [(set! var val) #t]
                [(with-continuation-mark key mark body) #t]
                [(#%plain-app . exprs) #t]
                [(#%plain-lambda . exprs) #t]
                [(case-lambda . exprs) #t]
                [_ #f])
               (begin
                 (hash-set! breakpoints pos #f)
                 (when (not is-tail?)
                   (hash-set! breakpoints (+ pos (syntax-span expr) -1) #f))
                 #t))))
      
      (define (let/rec-values-annotator letrec?)
        (kernel:kernel-syntax-case
         expr #f
         [(label (((var ...) rhs) ...) . bodies)
          (let* ([new-bindings (apply append
                                      (map syntax->list
                                           (syntax->list #`((var ...) ...))))]
                 [all-bindings (append new-bindings bound-vars)]
                 [new-rhs (map (lambda (expr)
                                 (annotate expr 
                                           (if letrec? all-bindings bound-vars)
                                           #f module-name ))
                               (syntax->list #'(rhs ...)))]
                 [last-body (car (reverse (syntax->list #'bodies)))]
                 [all-but-last-body (reverse (cdr (reverse (syntax->list #'bodies))))]
                 [bodies (append (map (lambda (expr)
                                        (annotate expr all-bindings #f module-name ))
                                      all-but-last-body)
                                 (list (annotate
                                        last-body
                                        all-bindings 
                                        is-tail? module-name )))]
                 [local-debug-info (assemble-debug-info new-bindings new-bindings 'normal #f)]
                 [previous-bindings (previous-bindings bound-vars)])
            (for-each (lambda (id) (record-bound-id 'bind id id)) new-bindings)
            (with-syntax ([(new-rhs/trans ...) new-rhs]
                          [previous-bindings previous-bindings])
              (if letrec?
                  (quasisyntax/loc expr
                    (let ([old-bindings previous-bindings])
                      (label (((debugger-local-bindings) (#%plain-lambda ()
                                                                         (#%plain-app
                                                                          list*
                                                                          #,@local-debug-info
                                                                          old-bindings)))
                              ((var ...) new-rhs/trans) ...)
                             #,@bodies)))
                  (quasisyntax/loc expr
                    (label (((var ...) new-rhs/trans) ...)
                           (let ([debugger-local-bindings (#%plain-lambda ()
                                                                          (#%plain-app
                                                                           list*
                                                                           #,@local-debug-info
                                                                           previous-bindings))])
                             #,@bodies))))))]))
      
      (define (lambda-clause-annotator clause)
        (kernel:kernel-syntax-case
         clause #f
         [(arg-list . bodies)
          (let* ([new-bound-vars (arglist-bindings #'arg-list)]
                 [all-bound-vars (append new-bound-vars bound-vars)]
                 [new-bodies (let loop ([bodies (syntax->list #'bodies)])
                               (if (equal? '() (cdr bodies))
                                   (list (annotate (car bodies) all-bound-vars #t module-name ))
                                   (cons (annotate (car bodies) all-bound-vars #f module-name )
                                         (loop (cdr bodies)))))])
            (for-each (lambda (id) (record-bound-id 'bind id id)) new-bound-vars)
            (quasisyntax/loc clause
              (arg-list 
               (let ([debugger-local-bindings
                      (#%plain-lambda ()
                                        (#%plain-app
                                         list*
                                         #,@(assemble-debug-info new-bound-vars new-bound-vars 'normal #f)
                                         #,(previous-bindings bound-vars)))])
                 #,@new-bodies))))]))
      
      (define annotated
        (syntax-recertify
         (kernel:kernel-syntax-case
          expr #f
          [var-stx (identifier? (syntax var-stx))
                   (let ([binder (and (syntax-original? expr)
                                      (srfi:member expr bound-vars free-identifier=?))])
                     (if binder
                         (record-bound-id 'ref expr (car binder))
                         (record-bound-id 'top-level expr expr))
                     expr)]
          
          [(#%plain-lambda . clause)
           (quasisyntax/loc expr 
             (#%plain-lambda #,@(lambda-clause-annotator #'clause)))]
          
          [(case-lambda . clauses)
           (quasisyntax/loc expr
             (case-lambda #,@(map lambda-clause-annotator (syntax->list #'clauses))))]
          
          [(if test then else)
           (quasisyntax/loc expr (if #,(annotate #'test bound-vars #f module-name )
                                     #,(annotate #'then bound-vars is-tail? module-name )
                                     #,(annotate #'else bound-vars is-tail? module-name )))]
          
          [(begin . bodies)
           (letrec ([traverse
                     (lambda (lst)
                       (if (and (pair? lst) (equal? '() (cdr lst)))
                           `(,(annotate (car lst) bound-vars is-tail? module-name ))
                           (cons (annotate (car lst) bound-vars #f module-name )
                                 (traverse (cdr lst)))))])
             (quasisyntax/loc expr (begin #,@(traverse (syntax->list #'bodies)))))]
          
          [(begin0 . bodies)
           (quasisyntax/loc expr (begin0 #,@(map (lambda (expr)
                                                   (annotate expr bound-vars #f module-name ))
                                                 (syntax->list #'bodies))))]
          
          [(let-values . clause)
           (let/rec-values-annotator #f)]
          
          [(letrec-values . clause) 
           (let/rec-values-annotator #t)]
          
          [(set! var val)
           (let ([binder (and (syntax-original? #'var)
                              (srfi:member #'var bound-vars free-identifier=?))])
             (when binder
               (record-bound-id 'set expr (car binder)))
             (quasisyntax/loc expr (set! var #,(annotate #`val bound-vars #f module-name ))))]
          
          [(quote _) expr]
          
          [(quote-syntax _) expr]
          
          [(with-continuation-mark key mark body)
           (quasisyntax/loc expr (with-continuation-mark key
                                   #,(annotate #'mark bound-vars #f module-name )
                                   #,(annotate #'body bound-vars is-tail? module-name )))]
          
          [(#%plain-app . exprs)
           (let ([subexprs (map (lambda (expr) 
                                  (annotate expr bound-vars #f module-name ))
                                (syntax->list #'exprs))])
             (if (or is-tail? (not (syntax-source expr)))
                 (quasisyntax/loc expr (#%plain-app . #,subexprs))
                 (wcm-wrap (make-debug-info module-name expr bound-vars bound-vars 'normal #f (previous-bindings bound-vars))
                           (quasisyntax/loc expr (#%plain-app . #,subexprs)))))]
          
          [(#%top . var) expr]
          [(#%variable-reference . _) expr]
          
          [else (error 'expr-syntax-object-iterator "unknown expr: ~a"
                       (syntax->datum expr))])
         expr
         (current-code-inspector)
         #f))
      
      (if annotate-break?
          (break-wrap
           (make-debug-info module-name expr bound-vars bound-vars 'at-break #f (previous-bindings bound-vars))
           annotated
           expr
           is-tail?)
          annotated))
    
    (values (top-level-annotate stx) (hash-map breakpoints (lambda (k v) k)))))

(provide annotate-stx)