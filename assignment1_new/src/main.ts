import "./style.css";
import { interval, fromEvent} from 'rxjs'
import { map, scan, filter, merge} from 'rxjs/operators'


function main() {
  // selecting svg to use as canvas
  const svg = document.querySelector("#svgCanvas") as SVGElement & HTMLElement;
  
  // This class contains all constants used in this file (width, height, etc)
  // it is set to readonly to prevent from overriding
  const Constants = new class{
    readonly GAME_TICK_DURATION = 10
    readonly CANVAS_WIDTH = 800
    readonly CANVAS_HEIGHT = 800
    readonly BORDER_LIMIT = 750
    readonly SCORE_POS_X = 10
    readonly SCORE_POS_Y = 50
    readonly SCORE_COLOR = "white"
    readonly POP_UP_POS_X = 200
    readonly POP_UP_POS_Y = 500
    readonly POP_UP_GAMEOVER_COLOR = "red"
    readonly POP_UP_GAMEWIN_COLOR = "green"
    readonly POP_UP_SIZE = "60px"
    readonly FROG_POS_X = 375
    readonly FROG_POS_Y = 750
    readonly FROG_WIDTH = 50
    readonly FROG_HEIGHT = 50
    readonly FROG_COLOUR = "rgb(0, 145, 24)"
    readonly CAR_ALL_HEIGHT = 50
    readonly CAR_ALL_WIDTH = 100
    readonly CAR_COLOUR = "white"
    readonly LOG_ALL_HEIGHT = 50
    readonly LOG_ALL_WIDTH = 175
    readonly LOG_COLOUR = "#654321"
    readonly ENEMY_ALL_HEIGHT = 50
    readonly ENEMY_ALL_WIDTH = 125
    readonly ENEMY_COLOUR = "#C22542"
  } 
    
  // The game state transitions 
  class Tick { constructor(public readonly elapsed:number) {} }
  class Move { constructor(public readonly x: number, public readonly y: number) {} }

  // type of keyboard presses accepted to move the frog 
  type Key = 'a' | 'd' | 'w' | 's' 

  // All of those that move are a body type (frog, cars, logs)
  // velocity is used to move the cars and logs, the number represents the increment in the x-axis, it moves right if positive and left if negative
  type Body = Readonly<{
    id: string;
    x: number;
    y: number;
    velocity: number
  }> 

  // the 4 sections in the canvas
  type section = Readonly<'ground' | 'river' | 'winArea' | 'safeZone'>

  // the game state
  type State =Readonly<{
    time: number,
    plyrfrog: Body;
    car: Readonly<Body[]>,
    log: Readonly<Body[]>,
    enemy: Readonly<Body[]>,
    gameOver: boolean,
    gameWin: boolean,
    gameSection: section,
    isOnLog: boolean,
    score: number,
    level: number,
  }>

  // The initial states of the frog, cars, logs, enemies, and the master state
  // This are manually setted because we want it to consistently start the same way 
  // ---------------------------------------------------------------------------------------
  // initialFrog velocity is zero because we do the frogs movement using obsevables, 
  // but it will be used later on when the frog is moving through river section (to move the frog along with the logs)
  const initialFrog: Body = {id: 'frog', x: Constants.FROG_POS_X, y: Constants.FROG_POS_Y, velocity:0}
  const initialCars: Body[] = [
    {id:'car1a',x:0,y:700,velocity:1 }, 
    {id:'car1b',x:400,y:700,velocity:1 },
    {id:'car2a',x:100,y:650,velocity:-1 },
    {id:'car2b',x:500,y:650,velocity:-1 },
    {id:'car3a',x:100,y:600,velocity:1 },
    {id:'car3b',x:500,y:600,velocity:1 },
    {id:'car4a',x:0,y:550,velocity:-1 },
    {id:'car4b',x:400,y:550,velocity:-1 },
    {id:'car5a',x:0,y:500,velocity:3 },
    {id:'car5b',x:400,y:500,velocity:3 },
  ]
  const initialLogs: Body[] = [
    {id:'log1a',x:0,y:400,velocity:1 }, 
    {id:'log1b',x:400,y:400,velocity:1 },
    {id:'log2a',x:100,y:350,velocity:-1 },
    {id:'log3b',x:500,y:300,velocity:1 },
    {id:'log4a',x:0,y:250,velocity:-1 },
    {id:'log4b',x:400,y:250,velocity:-1 },
    {id:'log5a',x:0,y:200,velocity:3 },
  ]
  const initialEnemies: Body[] =[
    {id:'enemy1',x:100,y:300,velocity:2 },
    {id:'enemy2',x:500,y:350,velocity:-2 },
    {id:'enemy3',x:400,y:200,velocity:4 },
  ]
  const initialState: State ={
    time: 0,
    plyrfrog: initialFrog,
    car: initialCars,
    log: initialLogs,
    enemy: initialEnemies,
    gameOver: false,
    gameWin: false,
    gameSection: 'safeZone',
    isOnLog: false,
    score: 0,
    level: 1,
  }



  // moveWrap function to handle the animate/movement and wrappings of obstacles (cars/logs), 
  // by using the x-axis of the obstacle we can check if the obstacle has went over the border (left or right, since the obstacle can go in different directions), 
  // if they did went over, then we set the position of the obstacle back to 0 or the width of the canvas (wrapping).
  const moveWrap = (o:Body, velocity:number):Body => <Body>{
    ...o,
    x: o.x>Constants.CANVAS_WIDTH? 0 : o.x<0? Constants.CANVAS_WIDTH : o.x + velocity
  }
   

  // Used to check for collision
  // checks for car and log collision
  // the game ends if we collide with a car but not with a log
  // game is over if we are in the river section and the frog is not on a log
  // boundary is created so that the frog doesn't move over the canvas, the game is over if the frog went over the canvas
  // updates the state if the game is over, if the frog is on a log, and to move the frog along with the log if it is on top of a log
  const handleCollision = (s:State):State => {
    const 
      collisionDetected = (f:Body, obs:Body, obsWidth:number)=>  f.x + Constants.FROG_WIDTH > obs.x && f.x < obs.x + obsWidth && f.y == obs.y,
      carCollision = s.car.filter((car:Body)=>collisionDetected(s.plyrfrog,car,Constants.CAR_ALL_WIDTH)).length === 1,
      logCollision = s.log.filter((log:Body)=>collisionDetected(s.plyrfrog,log,Constants.LOG_ALL_WIDTH)),
      enemyCollision = s.enemy.filter((enem:Body)=>collisionDetected(s.plyrfrog,enem,Constants.ENEMY_ALL_WIDTH)).length === 1,
      logCollided = logCollision.length === 1,
      boundary = s.plyrfrog.x>Constants.CANVAS_WIDTH-50 || s.plyrfrog.x<=0 || s.plyrfrog.y >= 800,
      riverGameover = !logCollided && s.gameSection ==='river',
      frogOnLog = (list:Body[]) => logCollided ? moveWrap(s.plyrfrog, list[0].velocity) : s.plyrfrog
      // repositionFrog = s.gameSection === 'winArea' ? 

      if (s.gameSection === 'winArea') { 
        return {
          ...s, plyrfrog:initialFrog
        }
      } else {
        return <State> {
          ...s,
          plyrfrog: frogOnLog(logCollision),
          gameOver: carCollision || boundary || riverGameover || enemyCollision,
          isOnLog: logCollided,
          // gameWin: 
        }
      }

  }



  // interval tick
  // contains sectionDetection to detect with section type the frog is currently at
  // contains scoring to calculate the score of the game // updates the car, log, enemy, score, time, gameSection, and gameWin 
  const tick = (s:State, elapsed:number):State => {
    // to check which section the player/frog is at currently 
    // by checking the y-axis of the from on the canvas
    const sectionDetection = (s: State):section => 
      s.plyrfrog.y>=450 && s.plyrfrog.y<=Constants.CANVAS_HEIGHT-50 ? 'ground' : 
      s.plyrfrog.y>=200 && s.plyrfrog.y<=400 ? 'river'  :
      s.plyrfrog.y>=100 && s.plyrfrog.y<150 ? 'winArea' : 'safeZone'
      
    //given +50 points for every line crossed and bonus points are awarded if winning and by using the time (lesser time = higher bonus score)
    const scoring = (s:State):number => s.score === 650? s.score + s.score*500/elapsed : 
                                 Constants.CANVAS_HEIGHT-s.plyrfrog.y-50>s.score? Constants.CANVAS_HEIGHT-s.plyrfrog.y-50 : s.score
                          
    return handleCollision({
      ...s,
      time: elapsed,
      score: scoring(s),
      car: s.car.map((c:Body)=>moveWrap(c,c.velocity)),
      log: s.log.map((l:Body)=>moveWrap(l,l.velocity)),
      enemy: s.enemy.map((e:Body)=>moveWrap(e,e.velocity)),
      gameSection: sectionDetection(s),
      // gameWin: ,
    })
  }
  

  // Moving the frog in which the player controls using keyboard button press
  // I didn't filter repeats, this is to ensure smoother gameplay (if you hold down the keys it will repeating automatically to move to that direction)
  const keyPress = <T>( k:Key, result:()=>T)=>
    fromEvent<KeyboardEvent>(document,'keydown')
        .pipe(
          filter(({key})=>key === k),
          map(result)), 
    // Pressing the keyboard buttons to move
    moveLeft   = keyPress('a', ()=>new Move(-50, 0)),
    moveRight  = keyPress('d', ()=>new Move(50, 0)),
    moveDown   = keyPress('s', ()=>new Move(0,50)),
    moveUp     = keyPress('w', ()=>new Move(0,-50))


  // state reducer, it takes in takes in the state and the event (move or tick) and calculate all the needed actions (movinf frog, cars, increase score, etc)
  // if it doesn't detect a move event then the stateReduction will execute the non-frog/non-player movement and everything else
  const stateReduction = (s: State, event: Move | Tick): State => 
    event instanceof Move ? {
      ...s,
      plyrfrog: {...s.plyrfrog, x: s.plyrfrog.x + event.x, y: s.plyrfrog.y + event.y}} :   
    tick(s, event.elapsed)
  



  // #########################################################
  // #########################################################
  // ########## THIS PART CONTAINS IMPURE FUNCTIONS ##########
  // #########################################################
  // #########################################################

  // Updateview contains all the nessesary actions for updating or modifying the HTML elements based on the states from the stateReduction
  // In here some impurity and side-effects are present and are allowed
  const updateView = (s:State):void=>{
    // function to create rectangle elements such as frog, cars, and logs
    // if its already created then we will just update the attributes
    const createRect = (rectID:string, rectX:number, rectY:number, rectWidth:number, rectHeight:number, rectFill:string) => {
      const element = document.getElementById(rectID)
      if (element === null){
      const newObj = document.createElementNS(svg.namespaceURI, "rect")!;
        newObj.setAttribute("id", String(rectID))
        newObj.setAttribute("x", String(rectX))
        newObj.setAttribute("y", String(rectY))
        newObj.setAttribute("width", String(rectWidth))
        newObj.setAttribute("height", String(rectHeight))
        newObj.setAttribute("style", `fill: ${rectFill}`)
        svg.appendChild(newObj)
        return newObj;
      } else {
      element.setAttribute("x", String(rectX))
      element.setAttribute("y",String(rectY))
      }
    }

    // creating and/or updating the car elements (since it is a list we use forEach function)
    s.car.forEach((car:Body)=>{
      createRect(car.id,car.x,car.y,Constants.CAR_ALL_WIDTH,Constants.CAR_ALL_HEIGHT,Constants.CAR_COLOUR)
    })

    // creating and/or updating the log elements (since it is a list we use forEach function)
    s.log.forEach((log:Body)=>{
      createRect(log.id,log.x,log.y,Constants.LOG_ALL_WIDTH,Constants.LOG_ALL_HEIGHT,Constants.LOG_COLOUR)
    })

    // creating and/or updating the enemy elements (since it is a list we use forEach function)
    s.enemy.forEach((enemy:Body)=>{
      createRect(enemy.id,enemy.x,enemy.y,Constants.ENEMY_ALL_WIDTH,Constants.ENEMY_ALL_HEIGHT,Constants.ENEMY_COLOUR)
    })

    // creating and/or updating the Frog view
    createRect(s.plyrfrog.id,s.plyrfrog.x,s.plyrfrog.y,Constants.FROG_WIDTH,Constants.FROG_HEIGHT,Constants.FROG_COLOUR)
    
    // creating the score text element if there is none yet  
    // updating the score as the game goes on 
    const scoreHeader = document.getElementById('score')
    if (scoreHeader === null){
      const newScore = document.createElementNS(svg.namespaceURI, 'text')
      newScore.setAttribute("id", 'score')
      newScore.setAttribute("x", String(Constants.SCORE_POS_X))
      newScore.setAttribute("y", String(Constants.SCORE_POS_Y))
      newScore.setAttribute("style", `fill:${Constants.SCORE_COLOR}`)
      newScore.setAttribute("font-size", "30px")
      newScore.textContent = "SCORE: " + (s.score).toFixed(3).toString()
      svg.appendChild(newScore)
    } else {
      scoreHeader.textContent = "SCORE: " + (s.score).toFixed(0).toString()
    }


    // Creates the pop up texts if we end the game
    // unsubscribed here to stop the game
    const endGameText = (textX:number, textY:number, textFill:string, textFontSize:string) =>
      (textContent: string)=>{
        subscription.unsubscribe();
        createRect('background', 0, 50, Constants.CANVAS_WIDTH, Constants.CANVAS_HEIGHT, "rgba(0,0,0,0.5)")
        const popUp = document.createElementNS(svg.namespaceURI, 'text')
        popUp.setAttribute("x", String(textX))
        popUp.setAttribute("y", String(textY))
        popUp.setAttribute("style", `fill:${textFill}`)
        popUp.setAttribute("font-size", String(textFontSize))
        popUp.textContent = textContent 
        svg.appendChild(popUp)
      }
    // Check if the game is over, if it does creates a pop up text stating "GAMEOVER!"
    if (s.gameOver){
      endGameText(Constants.POP_UP_POS_X,Constants.POP_UP_POS_Y,Constants.POP_UP_GAMEOVER_COLOR,Constants.POP_UP_SIZE)("GAMEOVER!")
    }
    // Checking if we won the game, if it does creates a pop up text stating "GAME WIN!"
    // if (s.gameWin){
    //   endGameText(Constants.POP_UP_POS_X,Constants.POP_UP_POS_Y,Constants.POP_UP_GAMEWIN_COLOR,Constants.POP_UP_SIZE)("GAME WIN!")
    // }
  }

  // The main game stream
  // merges all the keyboard stream 
  // use scan to as accumulator 
  // subsribe to updateView to do changes on HTML elements
  const subscription = interval(Constants.GAME_TICK_DURATION)
    .pipe(
      map(elapsed=>new Tick(elapsed)),
      merge(moveLeft, moveRight, moveUp, moveDown),
      scan(stateReduction, initialState)
    ).subscribe(updateView)

}
// The following simply runs your main function on window load.  Make sure to leave it in place.
if (typeof window !== "undefined") {
  window.onload = () => {
    main();
  };
}
