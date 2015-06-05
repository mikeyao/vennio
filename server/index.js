var express = require('express');
var app = express();
var request = require('request');
var rp = require('request-promise');
var promise = require('bluebird');
var fs = promise.promisifyAll(require('fs'));
var mongoose = require('mongoose');
var helper = require('./helper.js');


var port = process.env.PORT || 3000;
var db = process.env.MONGOLAB_URI || 'mongodb://localhost/vennio';
mongoose.connect(db);

var Schema = mongoose.Schema;

//Schema for the first version of Jobs from the angel list API
var jobsSchema = new Schema({
  jobs: Object,
  page: Number
});

//Not being used at the moment, but will use it to get average minimum and maximum salaries for each skill in the database
var salarySchema = new Schema({
  skill: String,
  salary_min: Number,
  salary_max: Number
});

//Schema is not being used, but it is there as a reference for the object stored in "Startup" property of each job in "jobsClean" schema
var startupSchema = new Schema({
  name: String,
  angellist_url: String,
  logo_url: String,
  thumb_url: String,
  quality: Number,
  product_desc: String,
  high_concept: String,
  follower_count: Number,
  company_url: String,
  created_at: String,
  updated_at: String
});

//Schema for each job
var jobsClean = new Schema({
  title: String,
  description: String,
  created_at: String,
  updated_at: String,
  equity_cliff: String,
  equity_min: String,
  equity_max: String,
  equity_vest: String,
  currency_code: String,
  job_type: String,
  salary_min: Number,
  salary_max: Number,
  angellist_url: String,
  locations: Object,
  roles: Object,
  skills: Object,
  startup: Object
})

var Jobs = mongoose.model('Jobs', jobsSchema);
var JobsClean = mongoose.model('JobsClean', jobsClean);
  
//Used an array of pages to iterate through all objects in the initial dirty version of angel list data
var pages = [];
for(var x = 0; x <= 440; x++) {
  pages.push(x);
}

//Home page
app.get('/', function (req, res) {
  res.send('Hello World!');
});

//Poll Angel List API to get 440 pages of jobs
app.get('/getjobs', function(req,res) {
  promise.map(pages, function(item) {
    var currPage = item+1;
    rp('https://api.angel.co/1/jobs?page='+currPage+'&access_token=6c28aa3c9a31bbd42774ca9aae29824d61cf6f86dc2dcfbe')
    .then(function (body) {
      console.log('made REQ', body);
      var job = new Jobs({
        jobs: body,
        page: currPage
      })
      //Write all jobs to a text file for backup
      fs.appendFileSync('data.txt', JSON.stringify(body));
      job.save(function(err) {
        console.log('in SAVE');
        if (err) console.log('ERROR IN MONGO: ', err);
      });
    })
    //End when we reach the last page
    .then(function(body) {
      if(item >= 440) {
        res.send('END');
      }
    })
    .catch(function(err){console.log('in catch', err); res.sendStatus(401);})
  });
});


//Send all jobs from the table "JobsClean" to the user
app.get('/viewJobs', function(req, res) {
  JobsClean.find({}, function(err, jobs) {
    res.send(jobs);
  });
});

app.get('/viewJobs/:page', function(req, res) {
 var page = req.params.page;
 Jobs.find({'page': page}, null, {sort: {'_id': 1}, limit: 1}, function(err, jobs) {
   res.send(jobs);
 });
});

//Send all jobs from the table "JobsClean" that have really high salaries to the user
app.get('/outliers', function(req, res) {
  var query = {};
  var skill = req.params.skill;
  var outlier = {"salary_max": {"$gt": 100000}}
  JobsClean.find(outlier, function(err, jobs) {
    console.log(jobs);
    res.send(jobs);
  });
});


//A shell for getting all currencies from the database
app.get('/getCurrencies', function(req, res) {
  var currencies = {};
  var query = {};
  var projection = {};
  projection.currency_code = true;
  JobsClean.find(query, projection, null, function(err, currencyCodes){
  // JobsClean.find(query, function(err, currencyCodes){
    var result = currencyCodes.length;
    currencyCodes.forEach(function(currencyCode){
      var currency_code = currencyCode.currency_code;
      if (!currencies.hasOwnProperty(currency_code)){
        currencies[currency_code] = 1;
      } else {
        currencies[currency_code] += 1;
      }
    });

    res.send(currencies);
  });
});

app.get('/roles', function(req, res) {
  var roles = {};
  var query = {};
  var projection = {};
  projection.roles = true;
  JobsClean.find(query, projection, null, function(err, roles){
  // JobsClean.find(query, function(err, roles){
    var result = roles.length;
    roles.forEach(function(role){
      var currency_code = role.role;
      if (!roles.hasOwnProperty(role)){
        roles[role] = 1;
      } else {
        roles[role] += 1;
      }
    });

    res.send(roles);
  });
});

// Given a list skills, console.log avg salaries for each skill
var getAvgSalaryForSkills = function(skills){
  var avgSalaries = {};
  skills.forEach(function(skill){
    var skill = skill.toLowerCase();
    var query = {};
    query['skills.' + skill] = {$exists: true};
    JobsClean.find(query, function(err, jobs) {
      var count = jobs.length;
      console.log(count);
      var runningSalary_min = 0;
      var runningSalary_max = 0;
      jobs.forEach(function(job) {
        var convertedSalary = helper.validSalaryAndConvertionToUSD(job)
        if (convertedSalary){
          runningSalary_min += convertedSalary.min;
          runningSalary_max += convertedSalary.max;
        }
        // if return null mean current job is an outlier 
        else {
          count -= 1;
        }
        
      });
      var avg = (runningSalary_min+runningSalary_max)/2
      var salary = avg/count
      var avgSalary = salary.toString();
      avgSalaries[skill] = avgSalary;
      console.log("with Skills");
      console.log(avgSalaries);
    });
  });
};

// Give a list of skills, calculate the avg salaries if you don't have a particular skill
var getAvgSalaryForNotSkills = function(skills){
  var avgSalaries = {};
  skills.forEach(function(skill){
    var skill = skill.toLowerCase();
    console.log(skill);
    var query = {};
    query['skills.' + skill] = {$exists: true};
    JobsClean.find(query, function(err, jobs) {
      var count = jobs.length;
      console.log(count);
      var runningSalary_min = 0;
      var runningSalary_max = 0;
      jobs.forEach(function(job) {
        var convertedSalary = helper.validSalaryAndConvertionToUSD(job)
        if (convertedSalary){
          runningSalary_min += convertedSalary.min;
          runningSalary_max += convertedSalary.max;
        }
        // if return null mean current job is an outlier 
        else {
          count -= 1;
        }
        
      });
      var avg = (runningSalary_min+runningSalary_max)/2
      var salary = avg/count
      var avgSalary = salary.toString();
      avgSalaries[skill] = avgSalary;
      console.log("Not Skills");
      console.log(avgSalaries);
    });
  });
};

// Call the function below would console.log to console the results
// getAvgSalaryForSkills(helper.skills);
// getAvgSalaryForNotSkills(helper.skills);

app.get('/avgSalaries', function(req, res){
  var avgSalaries = getAvgSalaryForSkills(helper.skills);
});

//Send average salaries for Jobs that have a specific skill
app.get('/skill/:skill', function(req, res) {
  var query = {};
  var skill = req.params.skill;
  query['skills.' + skill] = {$exists: true};
  JobsClean.find(query, function(err, jobs) {
    var count = jobs.length;
    console.log(count);
    var runningSalary_min = 0;
    var runningSalary_max = 0;
    jobs.forEach(function(job) {
      var convertedSalary = helper.validSalaryAndConvertionToUSD(job)
      if (convertedSalary){
        runningSalary_min += convertedSalary.min;
        runningSalary_max += convertedSalary.max;
      }
      // if return null mean current job is an outlier 
      else {
        count -= 1;
      }
      
    });
    var avg = (runningSalary_min+runningSalary_max)/2
    res.send(avg/count + ' counts: ' + count);
  });
});

//Send average salaries for Jobs that do not have a specific skill
app.get('/notSkill/:skill', function(req, res) {
  var query = {};
  var skill = req.params.skill;
  query['skills.' + skill] = {$exists: false};
  JobsClean.find(query, function(err, jobs) {
    var count = jobs.length;
    console.log(count);
    var runningSalary_min = 0;
    var runningSalary_max = 0;
    jobs.forEach(function(job) {
      var convertedSalary = helper.validSalaryAndConvertionToUSD(job)
      if (convertedSalary){
        runningSalary_min += convertedSalary.min;
        runningSalary_max += convertedSalary.max;
      }
      // if return null mean current job is an outlier 
      else {
        count -= 1;
      }
    });
    var avg = (runningSalary_min+runningSalary_max)/2
    res.send(avg/count + ' counts: ' + count);
  });
});

// Step 1. Populate an object with {'javascript': 1, 'express': 2}
// Step 2. Go thru jobs, for arry skills, replace string with index from above object

var generateSkillsObject = function(){
  var query = {};
  var projection = {};
  projection.skills = true;
  JobsClean.find(query, projection, null, function(err, jobs){
    // jobs = [{'skills': {css:true, javascript: true}}, {}]
    var skillsObj = {};
    // initialize skill index, it's incremented for each new skill found
    var index = 0;
    // For testing purpose, replace with jobs once complete
    var part = jobs.slice(1,10);

    // Populate skillsObj with all unique skills as {'javascript': 0, 'express': 1}
    jobs.forEach(function(skills, i){
      // There are jobs without skills 
      if (skills.skills){
        for (var skill in skills.skills){
          if (!skillsObj.hasOwnProperty(skill)){
            skillsObj[skill] = index;
            index+=1;
          }
        }
      }
    });
    console.log(skillsObj);

    // Convert skillsObj to array of skills
    var skillsArray = [];
    for (var skill in skillsObj){
      skillsArray[skillsObj[skill]] = skill;
    }
    console.log(skillsArray);


    // Convert all skills in String to its index in skillsArray
    var transactions = [];
    jobs.forEach(function(skills, i){
      if (skills.skills){
        var skillsArray = Object.keys(skills.skills);
        var skillsConvertedToIndexes = skillsArray.map(function(skill){
          return skillsObj[skill];
        });
        transactions.push(skillsConvertedToIndexes);
      }
    });
    console.log(transactions);

    // Stringify transactions, prepare for file writing
    var transactionsStringified =  transactions.reduce(function(memo, transaction){
      return memo + transaction.toString() + '\n';
    }, '');

    // Stringify skills, prepare for file writing
    var skillsStringified =  skillsArray.reduce(function(memo, skill, index){
      return memo + index + ',' + JSON.stringify(skill.toString()) + '\n';
    }, '');

    fs.writeFile('transactions.csv', transactionsStringified, function (err) {
      if (err) throw err;
      console.log('It\'s saved!');
    });

    fs.writeFile('skills.csv', skillsStringified, function (err) {
      if (err) throw err;
      console.log('It\'s saved!');
    });

  });
};

// Enable this function if you want to generate data for apriori algorithm
// generateSkillsObject();



//getTags is used to get a clean version of Tags, because the raw data consists of multiple versions of the same skill ex. Project_Manager, project-manager
var getTags = function (str) {
  var result = [];
  var allSkills = str.split('/');
  for (var t = 0; t < allSkills.length; t++) {
    var tag_name = '';
    var curr_tag = allSkills[t].toLowerCase();
    for (var s = 0; s < curr_tag.length; s++) {
      if (curr_tag[s] === ' ' || curr_tag[s] === '-' || curr_tag[s] === '.') {
        tag_name = tag_name + '_';
      }
      else {
        tag_name = tag_name + curr_tag[s];
      }
    }
    result.push(tag_name);
  }
  return result;
}

//Do not run this!! It has already been run once. It parses the raw database with Angellist data and cleans it. 
app.get('/cleanDataaaaaa', function(req, res) {
  for (var x = 1; x <= 440; x++) {
    Jobs.find({page:x}, function(err, item) {
      if (err) res.send('ERROR: ' + err);
      else {
        //get an array of jobs
        var jobsArr = JSON.parse(item[0]['jobs'])['jobs'];
        // iterate through the jobs array and make a Schema for each job
        for(var j = 0; j < jobsArr.length; j++) {
          var locations = {};
          var roles = {};
          var skills = {};

          //iterate through all tags to get locations, roles, skills
          for (var t = 0; t < jobsArr[j].tags.length; t++) {
            var cleanTags = getTags(jobsArr[j].tags[t].name);
            console.log('cleantags: ', cleanTags);
            //cleanTags is an array. Iterate through it and add tags to locations, roles, skills
            for (var c = 0; c < cleanTags.length; c++) {
              if (jobsArr[j].tags[t].tag_type === 'LocationTag') {
                if (!locations.hasOwnProperty(cleanTags[c])) {
                  locations[cleanTags[c]] = true;
                }
              } else if (jobsArr[j].tags[t].tag_type === 'RoleTag') {
                if (!roles.hasOwnProperty(cleanTags[c])) {
                  roles[cleanTags[c]] = true;
                }
              } else if (jobsArr[j].tags[t].tag_type === 'SkillTag') {
                if (!skills.hasOwnProperty(cleanTags[c])) {
                  skills[cleanTags[c]] = true;
                }
              } else ;
            }
          }
          console.log('LOCATIONS: ', locations);
          console.log('ROLES: ', roles);
          console.log('SKILLS: ', skills);

          var startup = {
            name: jobsArr[j].startup.name,
            angellist_url: jobsArr[j].startup.angellist_url,
            logo_url: jobsArr[j].startup.logo_url,
            thumb_url: jobsArr[j].startup.thumb_url,
            quality: jobsArr[j].startup.quality,
            product_desc: jobsArr[j].startup.product_desc,
            high_concept: jobsArr[j].startup.high_concept,
            follower_count: jobsArr[j].startup.follower_count,
            company_url: jobsArr[j].startup.company_url,
            created_at: jobsArr[j].startup.created_at,
            updated_at: jobsArr[j].startup.updated_at
          }
          var job = {
            title: jobsArr[j].title,
            description: jobsArr[j].description,
            created_at: jobsArr[j].created_at,
            updated_at: jobsArr[j].updated_at,
            equity_cliff: jobsArr[j].equity_cliff,
            equity_min: jobsArr[j].equity_min,
            equity_max: jobsArr[j].equity_max,
            equity_vest: jobsArr[j].equity_vest,
            currency_code: jobsArr[j].currency_code,
            job_type: jobsArr[j].job_type,
            salary_min: jobsArr[j].salary_min,
            salary_max: jobsArr[j].salary_max,
            angellist_url: jobsArr[j].angellist_url,
            locations: locations,
            roles: roles,
            skills: skills,
            startup: startup
          }
          console.log('JOB: ', job);
          var jobsClean = new JobsClean(job);
          jobsClean.save(function(err){
            if (err) {
              console.log('ERR in CLEAN: ' + err);
              res.send(err);
            }
          });
        }
      }
    });
  }
  res.send('END');
});


//This function is incomplete. It's a shell function to get the average salaries for each skill using cleanData table
app.get('/tagSalary', function(req, res) {
  var skills = {

  }
  JobsClean.find({}, function(jobs) {
    jobs.forEach(function(){

    })
  })
  res.send('END');
});


var server = app.listen(port, function () {

  var host = server.address().address;
  var port = server.address().port;

  console.log('Example app listening at http://%s:%s', host, port);

});